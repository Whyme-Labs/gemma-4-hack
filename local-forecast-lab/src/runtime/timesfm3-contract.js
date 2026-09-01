const DEFAULT_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function product(shape) {
  return shape.reduce((value, dimension) => value * dimension, 1);
}

function index5(v, n, o, q, shape) {
  const [, variates, patches, outputPatch, quantiles] = shape;
  return ((((v * patches) + n) * outputPatch + o) * quantiles) + q;
}

function fitContext(values, length) {
  const finiteValues = Array.isArray(values) ? values : [];
  const output = new Float32Array(length);
  const mask = new Uint8Array(length).fill(1);
  const sourceStart = Math.max(0, finiteValues.length - length);
  const destinationStart = Math.max(0, length - finiteValues.length);
  for (let source = sourceStart; source < finiteValues.length; source += 1) {
    const destination = destinationStart + source - sourceStart;
    const value = finiteValues[source];
    if (Number.isFinite(value)) {
      output[destination] = value;
      mask[destination] = 0;
    }
  }
  return { values: output, mask };
}

function linearDetrend(values, mask) {
  const context = values.length;
  let n = 0;
  let sumT = 0;
  let sumT2 = 0;
  let sumY = 0;
  let sumTY = 0;
  for (let index = 0; index < context; index += 1) {
    if (mask[index]) continue;
    const time = (index - (context - 1)) / context;
    const value = values[index];
    n += 1;
    sumT += time;
    sumT2 += time * time;
    sumY += value;
    sumTY += time * value;
  }
  if (!n) return { values, slope: 0, intercept: 0, applied: false };
  const determinant = n * sumT2 - sumT * sumT;
  const slope = determinant === 0 ? 0 : (n * sumTY - sumT * sumY) / determinant;
  const intercept = determinant === 0 ? sumY / n : (sumY - slope * sumT) / n;
  const detrended = new Float32Array(context);
  let sumOriginal2 = 0;
  let sumDetrended = 0;
  let sumDetrended2 = 0;
  const originalMean = sumY / n;
  for (let index = 0; index < context; index += 1) {
    if (mask[index]) continue;
    const time = (index - (context - 1)) / context;
    const value = values[index];
    const adjusted = value - (slope * time + intercept);
    detrended[index] = adjusted;
    sumOriginal2 += value * value;
    sumDetrended += adjusted;
    sumDetrended2 += adjusted * adjusted;
  }
  const originalStd = Math.sqrt(Math.max(0, sumOriginal2 / n - originalMean * originalMean));
  const detrendedMean = sumDetrended / n;
  const detrendedStd = Math.sqrt(Math.max(0, sumDetrended2 / n - detrendedMean * detrendedMean));
  const applied = detrendedStd < 0.5 * originalStd;
  if (!applied) return { values, slope, intercept, applied: false };
  return { values: detrended, slope, intercept, applied: true };
}

export function validateTimesFmManifest(manifest) {
  assert(manifest && manifest.format === 'timesfm3-forward-onnx-v1', 'Unsupported TimesFM manifest format.');
  assert(Number.isInteger(manifest.contextLength) && manifest.contextLength > 0, 'Manifest contextLength is invalid.');
  assert(manifest.contextLength % 32 === 0, 'TimesFM contextLength must be divisible by 32.');
  assert(Number.isInteger(manifest.forecastHorizon) && manifest.forecastHorizon > 0, 'Manifest forecastHorizon is invalid.');
  assert(manifest.maxVariates === 32, 'This adapter currently requires the official 32-variate profile.');
  assert(manifest.inputPatchLength === 32 && manifest.outputPatchLength === 64, 'Unexpected TimesFM patch sizes.');
  assert(Array.isArray(manifest.quantiles) && manifest.quantiles.length === 9, 'Expected nine quantile heads.');
  return manifest;
}

export function buildTimesFmForwardInputs(request, manifest) {
  validateTimesFmManifest(manifest);
  const horizon = request.horizon ?? manifest.forecastHorizon;
  assert(horizon > 0 && horizon <= manifest.forecastHorizon, `Horizon must be at most ${manifest.forecastHorizon}.`);
  const targets = request.targets ?? [];
  const pastOnly = request.pastOnlyCovariates ?? [];
  const pastFuture = request.pastFutureCovariates ?? [];
  assert(targets.length > 0, 'TimesFM requires at least one target.');
  const activeVariates = targets.length + pastOnly.length + pastFuture.length;
  assert(activeVariates <= manifest.maxVariates, `Combined variates ${activeVariates} exceed ${manifest.maxVariates}.`);

  const context = manifest.contextLength;
  const modelHorizon = manifest.forecastHorizon;
  const patch = manifest.inputPatchLength;
  const rolls = manifest.outputPatchLength / patch;
  const extractLength = Math.min(2 * patch, manifest.outputPatchLength);
  const overlap = extractLength - patch;
  const forecastPatches = Math.max(Math.ceil((modelHorizon - overlap) / patch), 1);
  const horizonPatches = forecastPatches + rolls - 1;
  const paddedHorizon = horizonPatches * patch;
  const contextPatches = context / patch;
  const totalPatches = contextPatches + horizonPatches;
  const variates = manifest.maxVariates;

  const values = new Float32Array(variates * totalPatches * patch);
  const masks = new Uint8Array(variates * totalPatches * patch).fill(1);
  const patchIsTarget = new Uint8Array(variates * totalPatches);
  const patchCpmMask = new Uint8Array(totalPatches);
  patchCpmMask.fill(1, contextPatches);
  const trends = [];

  const writeSeries = (variateIndex, fitted, future, futureMask, isTargetLike) => {
    const detrended = linearDetrend(fitted.values, fitted.mask);
    trends[variateIndex] = { slope: detrended.slope, intercept: detrended.intercept, applied: detrended.applied };
    for (let index = 0; index < context; index += 1) {
      const flat = variateIndex * totalPatches * patch + index;
      values[flat] = fitted.mask[index] ? 0 : detrended.values[index];
      masks[flat] = fitted.mask[index];
    }
    if (future) {
      for (let index = 0; index < Math.min(modelHorizon, future.length); index += 1) {
        const flat = variateIndex * totalPatches * patch + context + index;
        const masked = futureMask?.[index] ?? !Number.isFinite(future[index]);
        if (!masked) {
          const time = (index + 1) / context;
          const trend = detrended.applied ? detrended.slope * time + detrended.intercept : 0;
          values[flat] = future[index] - trend;
          masks[flat] = 0;
        }
      }
    }
    if (isTargetLike) {
      for (let n = 0; n < totalPatches; n += 1) patchIsTarget[variateIndex * totalPatches + n] = 1;
    }
  };

  let variate = 0;
  for (const target of targets) writeSeries(variate++, fitContext(target.values, context), null, null, true);
  for (const covariate of pastOnly) writeSeries(variate++, fitContext(covariate.values, context), null, null, true);
  for (const covariate of pastFuture) {
    const all = covariate.values ?? [];
    const contextValues = all.slice(0, Math.max(0, all.length - modelHorizon));
    const futureValues = all.slice(-modelHorizon);
    const futureMask = Array.from({ length: modelHorizon }, (_, index) => index >= horizon || !Number.isFinite(futureValues[index]));
    writeSeries(variate++, fitContext(contextValues, context), futureValues, futureMask, false);
  }
  for (; variate < variates; variate += 1) trends[variate] = { slope: 0, intercept: 0, applied: false };

  return {
    horizon,
    modelHorizon,
    targetCount: targets.length,
    targetIds: targets.map((series, index) => series.id ?? `target_${index + 1}`),
    tensors: {
      values: { data: values, dims: [1, variates, totalPatches, patch], type: 'float32' },
      masks: { data: masks, dims: [1, variates, totalPatches, patch], type: 'bool' },
      patch_is_target: { data: patchIsTarget, dims: [1, variates, totalPatches], type: 'bool' },
      patch_cpm_mask: { data: patchCpmMask, dims: [1, totalPatches], type: 'bool' }
    },
    decode: { context, contextPatches, totalPatches, forecastPatches, extractLength, overlap, patch, trends }
  };
}

function readLogit(data, shape, variate, patchIndex, outputIndex, quantileIndex) {
  return data[index5(variate, patchIndex, outputIndex, quantileIndex, shape)];
}

export function decodeTimesFmLogits(logits, prepared, manifest) {
  const shape = logits.dims;
  assert(shape.length === 5, `Expected rank-5 logits, received [${shape.join(', ')}].`);
  assert(product(shape) === logits.data.length, 'TimesFM output shape does not match its data length.');
  const quantiles = manifest.quantiles ?? DEFAULT_QUANTILES;
  const { context, contextPatches, forecastPatches, extractLength, overlap, patch, trends } = prepared.decode;
  const output = [];

  for (let variate = 0; variate < prepared.targetCount; variate += 1) {
    const patchPredictions = [];
    for (let forecastPatch = 0; forecastPatch < forecastPatches; forecastPatch += 1) {
      const patchIndex = contextPatches - 1 + forecastPatch;
      const matrix = Array.from({ length: extractLength }, (_, outputIndex) =>
        quantiles.map((_, quantileIndex) => readLogit(logits.data, shape, variate, patchIndex, outputIndex, quantileIndex))
      );
      patchPredictions.push(matrix);
    }

    const stitched = [];
    stitched.push(...patchPredictions[0].slice(0, patch));
    for (let index = 0; index < patchPredictions.length - 1; index += 1) {
      const previous = patchPredictions[index];
      const next = patchPredictions[index + 1];
      for (let overlapIndex = 0; overlapIndex < overlap; overlapIndex += 1) {
        const weight = overlap <= 1 ? 1 : 1 - overlapIndex / (overlap - 1);
        stitched.push(quantiles.map((_, quantileIndex) =>
          weight * previous[patch + overlapIndex][quantileIndex] + (1 - weight) * next[overlapIndex][quantileIndex]
        ));
      }
      if (overlap < patch) stitched.push(...next.slice(overlap, patch));
    }
    if (patchPredictions.length) stitched.push(...patchPredictions.at(-1).slice(patch));

    const trend = trends[variate];
    const forecast = stitched.slice(0, prepared.horizon).map((values, index) => {
      const trendValue = trend.applied ? trend.slope * ((index + 1) / context) + trend.intercept : 0;
      const adjusted = values.map((value) => value + trendValue);
      const quantileMap = Object.fromEntries(quantiles.map((probability, q) => [String(probability), adjusted[q]]));
      return { step: index + 1, point: quantileMap['0.5'], quantiles: quantileMap };
    });
    output.push({ seriesId: prepared.targetIds[variate], forecast });
  }
  return output;
}
