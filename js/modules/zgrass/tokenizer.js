// tokenizer.js — Lexer: source string -> tokens
// ZGRASS tokens: numbers, identifiers, operators, strings ([], {}, "", ''), device vars ($XX)

export const TokenType = {
  NUMBER:    'NUMBER',
  STRING:    'STRING',
  IDENT:     'IDENT',      // variable or command name
  DEVICE:    'DEVICE',     // $XX device variable
  COLON:     'COLON',      // : (assignment)
  SEMI:      'SEMI',       // ; (statement separator)
  COMMA:     'COMMA',      // , (argument separator)
  LPAREN:    'LPAREN',     // (
  RPAREN:    'RPAREN',     // )
  PLUS:      'PLUS',       // +
  MINUS:     'MINUS',      // -
  STAR:      'STAR',       // *
  SLASH:     'SLASH',      // /
  BACKSLASH: 'BACKSLASH',  // \ (modulo)
  PERCENT:   'PERCENT',    // % (random between)
  AMP:       'AMP',        // & (string concat)
  EQ:        'EQ',         // == (equality)
  LT:        'LT',         // <
  GT:        'GT',         // >
  LE:        'LE',         // <=
  GE:        'GE',         // >=
  NE:        'NE',         // != or <>
  NOT:       'NOT',        // NOT
  AND:       'AND',        // AND (logical)
  OR:        'OR',         // OR (logical)
  DOT:       'DOT',        // . (switch prefix)
  NEWLINE:   'NEWLINE',    // end of line
  EOF:       'EOF',
};

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];

    // Skip spaces and tabs (but not newlines)
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // Newline
    if (ch === '\n' || ch === '\r') {
      tokens.push({ type: TokenType.NEWLINE, value: '\n' });
      if (ch === '\r' && i + 1 < len && source[i + 1] === '\n') i++;
      i++;
      continue;
    }

    // Comment: line starting with . (but only at start of line or after newline)
    // Actually in ZGRASS, . at start of a line is a comment but .B/.F are switches.
    // We'll handle . as DOT token and let the parser figure it out.

    // Numbers (including decimals)
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < len && ((source[i] >= '0' && source[i] <= '9') || source[i] === '.')) {
        // Don't consume . if it's followed by a letter (it's a switch like .B)
        if (source[i] === '.' && i + 1 < len && source[i + 1] >= 'A' && source[i + 1] <= 'Z') break;
        if (source[i] === '.' && i + 1 < len && source[i + 1] >= 'a' && source[i + 1] <= 'z') break;
        num += source[i];
        i++;
      }
      // Check if this number is immediately followed by letters (label like 1UP)
      if (i < len && isIdentStart(source[i])) {
        let label = num;
        while (i < len && isIdentChar(source[i])) {
          label += source[i];
          i++;
        }
        tokens.push({ type: TokenType.IDENT, value: label });
      } else {
        tokens.push({ type: TokenType.NUMBER, value: parseFloat(num) });
      }
      continue;
    }

    // Device variable $XX
    if (ch === '$') {
      let name = '$';
      i++;
      while (i < len && isIdentChar(source[i])) {
        name += source[i];
        i++;
      }
      tokens.push({ type: TokenType.DEVICE, value: name.toUpperCase() });
      continue;
    }

    // Identifiers (commands, variables)
    if (isIdentStart(ch)) {
      let ident = '';
      while (i < len && isIdentChar(source[i])) {
        ident += source[i];
        i++;
      }
      const upper = ident.toUpperCase();
      if (upper === 'NOT') {
        tokens.push({ type: TokenType.NOT, value: 'NOT' });
      } else if (upper === 'AND') {
        tokens.push({ type: TokenType.AND, value: 'AND' });
      } else if (upper === 'OR') {
        tokens.push({ type: TokenType.OR, value: 'OR' });
      } else {
        tokens.push({ type: TokenType.IDENT, value: ident });
      }
      continue;
    }

    // String literals: [nested brackets], {nested braces}, "...", '...'
    if (ch === '[') {
      i++;
      let depth = 1;
      let str = '';
      while (i < len && depth > 0) {
        if (source[i] === '[') depth++;
        else if (source[i] === ']') { depth--; if (depth === 0) { i++; break; } }
        str += source[i];
        i++;
      }
      tokens.push({ type: TokenType.STRING, value: str });
      continue;
    }

    if (ch === '{') {
      i++;
      let depth = 1;
      let str = '';
      while (i < len && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        str += source[i];
        i++;
      }
      tokens.push({ type: TokenType.STRING, value: str });
      continue;
    }

    if (ch === '"') {
      i++;
      let str = '';
      while (i < len && source[i] !== '"') {
        str += source[i];
        i++;
      }
      if (i < len) i++; // skip closing "
      tokens.push({ type: TokenType.STRING, value: str });
      continue;
    }

    if (ch === "'") {
      i++;
      let str = '';
      while (i < len && source[i] !== "'") {
        str += source[i];
        i++;
      }
      if (i < len) i++; // skip closing '
      tokens.push({ type: TokenType.STRING, value: str });
      continue;
    }

    // Two-character operators
    if (ch === '=' && i + 1 < len && source[i + 1] === '=') {
      tokens.push({ type: TokenType.EQ, value: '==' });
      i += 2;
      continue;
    }
    // Single = is also equality in ZGRASS (assignment uses :)
    if (ch === '=') {
      tokens.push({ type: TokenType.EQ, value: '=' });
      i++;
      continue;
    }
    if (ch === '<' && i + 1 < len && source[i + 1] === '=') {
      tokens.push({ type: TokenType.LE, value: '<=' });
      i += 2;
      continue;
    }
    if (ch === '>' && i + 1 < len && source[i + 1] === '=') {
      tokens.push({ type: TokenType.GE, value: '>=' });
      i += 2;
      continue;
    }
    if (ch === '!' && i + 1 < len && source[i + 1] === '=') {
      tokens.push({ type: TokenType.NE, value: '!=' });
      i += 2;
      continue;
    }
    if (ch === '<' && i + 1 < len && source[i + 1] === '>') {
      tokens.push({ type: TokenType.NE, value: '<>' });
      i += 2;
      continue;
    }

    // Single-character operators
    switch (ch) {
      case ':': tokens.push({ type: TokenType.COLON, value: ':' }); break;
      case ';': tokens.push({ type: TokenType.SEMI, value: ';' }); break;
      case ',': tokens.push({ type: TokenType.COMMA, value: ',' }); break;
      case '(': tokens.push({ type: TokenType.LPAREN, value: '(' }); break;
      case ')': tokens.push({ type: TokenType.RPAREN, value: ')' }); break;
      case '+': tokens.push({ type: TokenType.PLUS, value: '+' }); break;
      case '-': tokens.push({ type: TokenType.MINUS, value: '-' }); break;
      case '*': tokens.push({ type: TokenType.STAR, value: '*' }); break;
      case '/': tokens.push({ type: TokenType.SLASH, value: '/' }); break;
      case '\\': tokens.push({ type: TokenType.BACKSLASH, value: '\\' }); break;
      case '%': tokens.push({ type: TokenType.PERCENT, value: '%' }); break;
      case '&': tokens.push({ type: TokenType.AMP, value: '&' }); break;
      case '<': tokens.push({ type: TokenType.LT, value: '<' }); break;
      case '>': tokens.push({ type: TokenType.GT, value: '>' }); break;
      case '.': tokens.push({ type: TokenType.DOT, value: '.' }); break;
      default:
        // Skip unknown characters
        break;
    }
    i++;
  }

  tokens.push({ type: TokenType.EOF, value: null });
  return tokens;
}

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentChar(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
