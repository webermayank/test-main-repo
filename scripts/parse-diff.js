const fs = require('fs');

// Read the diff file
let diff;
try {
  diff = fs.readFileSync('diff.txt', 'utf8').split('\n');
} catch (error) {
  console.error('Error reading diff.txt:', error);
  fs.writeFileSync('changed-lines.txt', 'Error: Unable to read diff.txt');
  process.exit(1);
}

console.log('Diff content:', diff);

let currentFile = '';
const changes = {};

// Parse the diff
for (const line of diff) {
  if (line.startsWith('diff --git')) {
    currentFile = line.split(' ')[2].replace('a/', '');
    console.log('Processing file:', currentFile);
  } else if (line.startsWith('@@')) {
    console.log('Found diff line:', line);
    const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (match) {
      const startLine = parseInt(match[3]);
      const lineCount = parseInt(match[4]);
      const endLine = startLine + lineCount - 1;
      if (!changes[currentFile]) {
        changes[currentFile] = [];
      }
      changes[currentFile].push(`${startLine}-${endLine}`);
      console.log(`Detected change in ${currentFile}: lines ${startLine}-${endLine}`);
    } else {
      console.log('No match for diff line:', line);
    }
  }
}

// Format the output
let output;
if (Object.keys(changes).length === 0) {
  output = 'No specific line changes detected.';
  console.log('No changes detected - writing default message.');
} else {
  output = Object.entries(changes)
    .map(([file, lines]) => `- ${file} (lines ${lines.join(', ')})`)
    .join('\n');
  console.log('Final output:', output);
}

// Write the output to changed-lines.txt
fs.writeFileSync('changed-lines.txt', output);