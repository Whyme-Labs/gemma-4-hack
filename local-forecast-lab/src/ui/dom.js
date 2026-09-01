export function setText(element, value) {
  element.textContent = value ?? '';
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function selectedValues(select) {
  return [...select.selectedOptions].map((option) => option.value);
}

export function option(value, label = value, selected = false) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  return element;
}
