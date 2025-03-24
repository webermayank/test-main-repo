const fs = require('fs');

// Read the diff file
let diff;
try {
  diff = fs.readFileSync('diff.txt', 'utf8').split('\n');
} catch (error) {
  console.error('Error reading diff.txt:', error);
  process.exit(1);
}

console.log('Diff content:', diff);

let currentFile = '';
const changes = {};

// Parse the diff
for (const line of diff) {
  // Check if this line indicates a file
  if (line.startsWith('diff --git')) {
    currentFile = line.split(' ')[2].replace('a/', '');
    console.log('Processing file:', currentFile);
  }
  // Check if this line indicates a changed section
  else if (line.startsWith('@@')) {
    console.log('Found diff line:', line);
    const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (match) {
      const startLine = parseInt(match[3]); // Start line of the change
      const lineCount = parseInt(match[4]); // Number of lines changed
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
console.log(diff,"after");

// Format the output
if (Object.keys(changes).length === 0) {
  console.log('No changes detected.');
  console.log('No changes detected - please check the diff output.');
} else {
  const output = Object.entries(changes)
    .map(([file, lines]) => `- ${file} (lines ${lines.join(', ')})`)
    .join('\n');
  console.log('Final output:', output);
  console.log(output);
}