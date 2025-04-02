const fs = require('fs');

let diff = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  diff += chunk;
});

process.stdin.on('end', () => {
  // Add debug log at the beginning
  console.log('====== DEBUGGING PARSE-DIFF ======');
  console.log(`Received diff of length: ${diff.length}`);
  
  if (!diff.trim()) {
    console.log('No diff content received.');
    fs.writeFileSync(
      'changed-lines.json',
      JSON.stringify({ changes: {}, hasDocumentationChange: false }, null, 2)
    );
    return;
  }

  const diffLines = diff.split('\n');
  console.log(`Processing ${diffLines.length} lines of diff`);

  let currentFile = '';
  const changes = {};
  let hasDocumentationChange = false;
  let inDocBlock = false;
  let docBlockStartLine = 0;
  let hunkStartLine = 0;
  let currentHunk = null;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    // Detect file name
    if (line.startsWith('diff --git')) {
      currentFile = line.split(' ')[2].replace('a/', '');
      console.log(`Processing file: ${currentFile}`);
      inDocBlock = false;
    }
    // Detect hunk header (e.g., @@ -0,0 +1,1495 @@)
    else if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        hunkStartLine = parseInt(match[3]);
        currentHunk = {
          startLine: hunkStartLine,
          lines: []
        };
        console.log(`Found hunk starting at line ${hunkStartLine}`);
      }
    }
    // Look for JSDoc comment blocks in added/modified lines
    else if (line.startsWith('+')) {
      const content = line.substring(1);
      
      // Start of JSDoc block
      if (content.trim().startsWith('/**')) {
        inDocBlock = true;
        docBlockStartLine = hunkStartLine + currentHunk.lines.length;
        console.log(`Found JSDoc block starting at line ${docBlockStartLine}`);
        
        // Initialize the file in changes if not already there
        if (!changes[currentFile]) {
          changes[currentFile] = [];
        }
        
        // Start collecting context
        currentHunk.context = [content.trim()];
        hasDocumentationChange = true;
        console.log('Documentation change detected in JSDoc start');
      }
      // Within JSDoc block
      else if (inDocBlock) {
        // Add to context
        if (currentHunk.context) {
          currentHunk.context.push(content.trim());
        }
        
        // End of JSDoc block
        if (content.trim().endsWith('*/')) {
          const endLine = hunkStartLine + currentHunk.lines.length;
          console.log(`JSDoc block ends at line ${endLine}`);
          
          // Format context nicely
          const joinedContext = currentHunk.context.join(' ')
            .replace(/\*\//g, '')
            .replace(/\/\*\*/g, '')
            .replace(/\* /g, '')
            .replace(/\s+/g, ' ')
            .trim();
          
          // Get start and end context (first 10 words and last 10 words)
          const words = joinedContext.split(/\s+/);
          let start, end;
          
          if (words.length <= 20) {
            start = joinedContext;
            end = '';
          } else {
            start = words.slice(0, 10).join(' ') + '...';
            end = '...' + words.slice(-10).join(' ');
          }
          
          // Add to changes
          changes[currentFile].push({
            lines: `${docBlockStartLine}-${endLine}`,
            context: [{ start, end }]
          });
          console.log(`Added change entry for ${currentFile}: lines ${docBlockStartLine}-${endLine}`);
          
          inDocBlock = false;
        }
      }
      // Check for any other documentation-like content even if not in a formal block
      else if (content.includes('@param') || content.includes('@return') || 
               content.includes('@description') || content.includes('@example')) {
        hasDocumentationChange = true;
        console.log('Documentation change detected through JSDoc tag');
        
        // Initialize the file in changes if not already there
        if (!changes[currentFile]) {
          changes[currentFile] = [];
        }
        
        const lineNumber = hunkStartLine + currentHunk.lines.length;
        changes[currentFile].push({
          lines: `${lineNumber}`,
          context: [{ 
            start: content.trim().substring(0, 50) + (content.length > 50 ? '...' : ''), 
            end: '' 
          }]
        });
        console.log(`Added inline JSDoc change at line ${lineNumber}`);
      }
      
      // Track line count for accurate line numbers
      if (currentHunk) {
        currentHunk.lines.push(content);
      }
    }
    // Handle removed lines for JSDoc detection
    else if (line.startsWith('-')) {
      const content = line.substring(1);
      
      // If we find a removed JSDoc line, that's a documentation change
      if (content.trim().startsWith('/**') || 
          (content.trim().startsWith('*') && !content.trim().startsWith('*/')) || 
          content.trim().startsWith('*/') ||
          content.includes('@param') || content.includes('@return') || 
          content.includes('@description') || content.includes('@example')) {
        
        hasDocumentationChange = true;
        console.log('Documentation change detected in removed line');
        
        // Initialize the file in changes if not already there
        if (!changes[currentFile]) {
          changes[currentFile] = [];
        }
        
        // Get line number for this removal
        const lineNumber = hunkStartLine + currentHunk.lines.length;
        
        // Check if we already have an entry for this hunk
        const existingEntry = changes[currentFile].find(
          entry => {
            const [start, end] = entry.lines.split('-').map(Number);
            return lineNumber >= start - 3 && lineNumber <= end + 3; // Within 3 lines of existing entry
          }
        );
        
        if (!existingEntry) {
          changes[currentFile].push({
            lines: `${lineNumber}`,
            context: [{ 
              start: content.trim().replace(/^\*+\/?\s?/, '').substring(0, 50) + 
                    (content.length > 50 ? '...' : ''), 
              end: '' 
            }]
          });
          console.log(`Added change entry for removed line at ${lineNumber}`);
        }
      }
      
      // Track line count for accurate line numbers
      if (currentHunk) {
        currentHunk.lines.push(content);
      }
    }
    // Context lines (unchanged)
    else if (line.startsWith(' ')) {
      // Track line count for accurate line numbers
      if (currentHunk) {
        currentHunk.lines.push(line.substring(1));
      }
      
      // If we're in a doc block and see a context line with doc markers, continue tracking
      if (inDocBlock) {
        const content = line.substring(1);
        if (currentHunk.context) {
          currentHunk.context.push(content.trim());
        }
      }
    }
  }
  
  // Merge nearby line ranges to avoid fragmentation
  Object.keys(changes).forEach(file => {
    if (changes[file].length > 1) {
      console.log(`Merging ${changes[file].length} changes in ${file}`);
      changes[file] = mergeLineRanges(changes[file]);
      console.log(`After merging: ${changes[file].length} changes`);
    }
  });

  // Default to true for testing if we're having detection issues
  if (Object.keys(changes).length > 0) {
    hasDocumentationChange = true;
  }

  console.log('Final changes detection:', JSON.stringify(changes, null, 2));
  console.log('Has documentation change:', hasDocumentationChange);
  
  const jsonOutput = { changes, hasDocumentationChange };
  fs.writeFileSync('changed-lines.json', JSON.stringify(jsonOutput, null, 2));
  
  // Debug log at the end
  console.log('====== END DEBUGGING ======');
});

/**
 * Merge line ranges that are close to each other
 * @param {Array} entries - Array of change entries
 * @returns {Array} - Merged array of change entries
 */
function mergeLineRanges(entries) {
  if (entries.length <= 1) return entries;
  
  // Sort entries by starting line number
  entries.sort((a, b) => {
    const aStart = parseInt(a.lines.split('-')[0]);
    const bStart = parseInt(b.lines.split('-')[0]);
    return aStart - bStart;
  });
  
  const merged = [];
  let current = entries[0];
  
  for (let i = 1; i < entries.length; i++) {
    const currentEnd = current.lines.includes('-') 
      ? parseInt(current.lines.split('-')[1]) 
      : parseInt(current.lines);
      
    const nextStart = parseInt(entries[i].lines.split('-')[0]);
    
    // If the next range starts within 5 lines of the current range ending, merge them
    if (nextStart - currentEnd <= 5) {
      const nextEnd = entries[i].lines.includes('-') 
        ? parseInt(entries[i].lines.split('-')[1]) 
        : parseInt(entries[i].lines);
        
      current.lines = `${parseInt(current.lines.split('-')[0])}-${nextEnd}`;
      
      // Merge contexts
      if (entries[i].context && entries[i].context.length > 0) {
        if (!current.context) current.context = [];
        current.context = current.context.concat(entries[i].context);
      }
    } else {
      merged.push(current);
      current = entries[i];
    }
  }
  
  merged.push(current);
  return merged;
}