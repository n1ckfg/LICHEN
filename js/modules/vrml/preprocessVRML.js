// Text handling for the VRML module, from the vrml-qtvr-viewer project's
// p5js/js/vrml-viewer-p5.js. preprocessVRML() is copied unchanged.

// A .wrl may be gzipped (magic bytes 0x1f 0x8b). The viewer inflates it with
// pako; the browser's own DecompressionStream does the same without a library.
export async function decodeVRML(buffer) {
    let bytes = new Uint8Array(buffer);

    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }

    return new TextDecoder().decode(bytes);
}

// Sanitizes VRML97 that the loader's lexer and parser can't take: multiline
// strings, Script/PROTO fields, ROUTEs, hyphenated DEF/USE names, and the
// Script, PROTO and interpolator nodes themselves.
export function preprocessVRML(text) {
    // Collapse multiline strings into single lines
    // (VRMLLoader StringLiteral regex does not support newlines)
    {
        let result = '';
        let inString = false;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) {
                inString = !inString;
                result += text[i];
            } else if (inString && (text[i] === '\n' || text[i] === '\r')) {
                result += ' ';
            } else {
                result += text[i];
            }
        }
        text = result;
    }

    // Remove eventIn/eventOut/field declarations (Script/PROTO fields)
    text = text.replace(/^\s*(eventIn|eventOut|field)\s+.*$/gm, '');

    // Remove ROUTE lines (no-ops in VRMLLoader; avoids NodeName.event lexer conflicts)
    text = text.replace(/^\s*ROUTE\s+.*$/gm, '');

    // Replace hyphens in DEF/USE identifiers (unsupported by VRMLLoader lexer)
    text = text.replace(/\bDEF\s+(\S+)/g, (m, n) => 'DEF ' + n.replace(/-/g, '_'));
    text = text.replace(/\bUSE\s+(\S+)/g, (m, n) => 'USE ' + n.replace(/-/g, '_'));

    // Find matching close brace/bracket, skipping quoted strings
    function findClose(text, start, open, close) {
        let depth = 0, inStr = false;
        for (let i = start; i < text.length; i++) {
            if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) inStr = !inStr;
            if (!inStr) {
                if (text[i] === open) depth++;
                else if (text[i] === close) { depth--; if (depth === 0) return i; }
            }
        }
        return -1;
    }

    // Strip node blocks by type name (handles optional DEF prefix)
    function stripBlocks(text, nodeType) {
        const re = new RegExp('(DEF\\s+\\S+\\s+)?' + nodeType + '\\s*\\{', 'g');
        let match;
        const ranges = [];
        while ((match = re.exec(text)) !== null) {
            const braceStart = text.indexOf('{', match.index + (match[1] || '').length);
            const braceEnd = findClose(text, braceStart, '{', '}');
            if (braceEnd === -1) continue;
            ranges.push([match.index, braceEnd + 1]);
        }
        for (let i = ranges.length - 1; i >= 0; i--) {
            text = text.slice(0, ranges[i][0]) + text.slice(ranges[i][1]);
        }
        return text;
    }

    // Strip PROTO definitions; replace instances with Group
    {
        const re = /\bPROTO\s+(\w+)\s*\[/g;
        let match;
        const ranges = [];
        const protoNames = [];
        while ((match = re.exec(text)) !== null) {
            protoNames.push(match[1]);
            const bracketEnd = findClose(text, match.index + match[0].length - 1, '[', ']');
            if (bracketEnd === -1) continue;
            const bodyStart = text.indexOf('{', bracketEnd + 1);
            if (bodyStart === -1) continue;
            const bodyEnd = findClose(text, bodyStart, '{', '}');
            if (bodyEnd === -1) continue;
            ranges.push([match.index, bodyEnd + 1]);
        }
        for (let i = ranges.length - 1; i >= 0; i--) {
            text = text.slice(0, ranges[i][0]) + text.slice(ranges[i][1]);
        }
        for (const name of protoNames) {
            // In geometry fields, strip field + block (Group is not valid geometry)
            const geomRe = new RegExp('\\bgeometry\\s+' + name + '\\s*\\{', 'g');
            let gm;
            const geomRanges = [];
            while ((gm = geomRe.exec(text)) !== null) {
                const braceStart = text.indexOf('{', gm.index);
                const braceEnd = findClose(text, braceStart, '{', '}');
                if (braceEnd !== -1) geomRanges.push([gm.index, braceEnd + 1]);
            }
            for (let i = geomRanges.length - 1; i >= 0; i--) {
                text = text.slice(0, geomRanges[i][0]) + text.slice(geomRanges[i][1]);
            }
            // Elsewhere (e.g. children), replace with Group
            text = text.replace(new RegExp('\\b' + name + '\\s*\\{', 'g'), 'Group {');
        }
    }

    // Strip Script blocks
    text = stripBlocks(text, 'Script');

    // Strip interpolator nodes with NodeName regex prefix conflicts
    // (Color vs ColorInterpolator, Coordinate vs CoordinateInterpolator, etc.)
    for (const nodeType of ['ColorInterpolator', 'CoordinateInterpolator', 'NormalInterpolator']) {
        text = stripBlocks(text, nodeType);
    }

    return text;
}
