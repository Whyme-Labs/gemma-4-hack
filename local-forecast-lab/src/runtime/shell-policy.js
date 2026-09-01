const ALLOWED = new Set(['cat', 'head', 'tail', 'wc', 'cut', 'sort', 'uniq', 'grep', 'rg', 'awk', 'sed', 'jq', 'xan', 'column', 'tr', 'paste', 'join', 'printf', 'echo', 'ls', 'tree', 'file', 'stat']);
const FORBIDDEN = /(?:[><;]|&&|\|\||`|\$\(|\b(?:curl|python|python3|js-exec|sqlite3|bash|sh|source|eval|exec|rm|mv|cp|ln|chmod|touch|mkdir|tar|gzip)\b)/i;

export function validateShellCommand(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('Shell command is empty.');
  if (command.length > 1_000) throw new Error('Shell command exceeds 1,000 characters.');
  if (FORBIDDEN.test(command)) throw new Error('Shell command contains a forbidden operator or command.');
  const segments = command.split('|').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length || segments.length > 5) throw new Error('Shell pipeline must contain 1 to 5 commands.');
  for (const segment of segments) {
    const name = segment.split(/\s+/)[0];
    if (!ALLOWED.has(name)) throw new Error(`Command '${name}' is not allowed.`);
  }
  return command;
}
