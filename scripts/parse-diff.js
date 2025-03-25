const fs = require('fs');

let diff = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  diff += chunk;
});

process.stdin.on('end', () => {
  const diffLines = diff.split('\n');
  console.log('Diff content:', diffLines);

  let currentFile = '';
  const changes = {};

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' ')[2].replace('a/', '');
      console.log('Processing file:', currentFile);
    } else if (line.startsWith('new file mode')) {
      if (!changes[currentFile]) {
        changes[currentFile] = [];
      }
      changes[currentFile].push('new file');
      console.log(`Detected new file: ${currentFile}`);
    } else if (line.startsWith('deleted file mode')) {
      if (!changes[currentFile]) {
        changes[currentFile] = [];
      }
      changes[currentFile].push('deleted');
      console.log(`Detected deleted file: ${currentFile}`);
    } else if (line.startsWith('@@')) {
      console.log('Found diff line:', line);
      // Updated regex to match with optional context
      const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@(?: .*)?/);
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

  const jsonOutput = { changes };
  if (Object.keys(changes).length === 0) {
    console.log('No changes detected - writing default JSON.');
  } else {
    console.log('Changes detected:', jsonOutput);
  }

  fs.writeFileSync('changed-lines.json', JSON.stringify(jsonOutput, null, 2));
});