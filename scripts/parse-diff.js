const fs = require('fs');

let diff = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  diff += chunk;
});

process.stdin.on('end', () => {
  if (!diff.trim()) {
    console.log('No diff content received.');
    fs.writeFileSync('changed-lines.json', JSON.stringify({ changes: {}, hasDocumentationChange: false }, null, 2));
    return;
  }

  const diffLines = diff.split('\n');
  console.log('Diff content:', diffLines);

  let currentFile = '';
  const changes = {};
  let currentHunk = null;
  let hasDocumentationChange = false;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    // Detect file name
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' ')[2].replace('a/', '');
      console.log('Processing file:', currentFile);
    }
    // Detect new file
    else if (line.startsWith('new file mode')) {
      if (!changes[currentFile]) {
        changes[currentFile] = [];
      }
      changes[currentFile].push({ type: 'new file' });
      console.log(`Detected new file: ${currentFile}`);
    }
    // Detect deleted file
    else if (line.startsWith('deleted file mode')) {
      if (!changes[currentFile]) {
        changes[currentFile] = [];
      }
      changes[currentFile].push({ type: 'deleted' });
      console.log(`Detected deleted file: ${currentFile}`);
    }
    // Detect hunk header (e.g., @@ -0,0 +1,1495 @@)
    else if (line.startsWith('@@')) {
      console.log('Found diff line:', line);
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?/);
      if (match) {
        const startLine = parseInt(match[3]);
        const lineCount = match[4] ? parseInt(match[4]) : 1;
        const endLine = startLine + lineCount - 1;

        // Initialize changes for this file
        if (!changes[currentFile]) {
          changes[currentFile] = [];
        }

        // Collect added lines in this hunk
        const addedLines = [];
        let j = i + 1;
        let inCommentBlock = false;
        while (j < diffLines.length && !diffLines[j].startsWith('@@') && !diffLines[j].startsWith('diff --git')) {
          const currentLine = diffLines[j];
          if (currentLine.startsWith('+')) {
            const content = currentLine.substring(1).trim(); // Remove the '+' and trim
            if (content) {
              addedLines.push(content);

              // Check if the line is part of a JSDoc comment
              if (content.startsWith('/**')) {
                inCommentBlock = true;
                hasDocumentationChange = true;
              } else if (inCommentBlock && content.startsWith('*')) {
                hasDocumentationChange = true;
              } else if (content.startsWith('*/')) {
                inCommentBlock = false;
                hasDocumentationChange = true;
              }
            }
          } else if (currentLine.startsWith('-')) {
            const content = currentLine.substring(1).trim();
            if (content.startsWith('/**')) {
              inCommentBlock = true;
              hasDocumentationChange = true;
            } else if (inCommentBlock && content.startsWith('*')) {
              hasDocumentationChange = true;
            } else if (content.startsWith('*/')) {
              inCommentBlock = false;
              hasDocumentationChange = true;
            }
          }
          j++;
        }

        // Extract starting and ending words
        const maxWords = 3; // Number of words to show at start and end
        const context = addedLines.map(line => {
          const words = line.split(/\s+/).filter(word => word);
          if (words.length <= maxWords * 2) {
            return { start: line, end: '' }; // If line is short, show full line as start
          }
          const startWords = words.slice(0, maxWords).join(' ') + '...';
          const endWords = '...' + words.slice(-maxWords).join(' ');
          return { start: startWords, end: endWords };
        });

        // Add the change with line numbers and context
        changes[currentFile].push({
          lines: `${startLine}-${endLine}`,
          context: context.length > 0 ? context : [{ start: 'No content', end: '' }]
        });
        console.log(`Detected change in ${currentFile}: lines ${startLine}-${endLine}, context:`, context);
      } else {
        console.log('No match for diff line:', line);
      }
    }
  }

  const jsonOutput = { changes, hasDocumentationChange };
  if (Object.keys(changes).length === 0) {
    console.log('No changes detected - writing default JSON.');
  } else {
    console.log('Changes detected:', jsonOutput);
  }

  fs.writeFileSync('changed-lines.json', JSON.stringify(jsonOutput, null, 2));
});