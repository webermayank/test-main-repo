const fs = require('fs');

const diff = fs.readFileSync('diff.txt', 'utf8').split('\n');
let currentFile = '';
const changes = {};

for (const line of diff) {
  if (line.startsWith('diff --git')) {
    currentFile = line.split(' ')[2].replace('a/', '');
  } else if (line.startsWith('@@')) {
    const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (match) {
      const startLine = parseInt(match[3]);
      const lineCount = parseInt(match[4]);
      const endLine = startLine + lineCount - 1;
      if (!changes[currentFile]) {
        changes[currentFile] = [];
      }
      changes[currentFile].push(`${startLine}-${endLine}`);
    }
  }
}

const output = Object.entries(changes)
  .map(([file, lines]) => `- ${file} (lines ${lines.join(', ')})`)
  .join('\n');
console.log(output);