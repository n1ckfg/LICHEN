// tokenizer.js — Lexer: source string -> tokens
// GRASS tokens: numbers, identifiers, operators, strings ([], {}, "", ''), device vars ($XX)

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
  NE:        'NE',         // #, <> or !=
  NOT:       'NOT',        // NOT
  AND:       'AND',        // AND or && (logical)
  OR:        'OR',         // OR or || (logical)
  BANG:      'BANG',       // ! (absolute value, unary)
  AT:        'AT',         // @ (indirection: the name a string holds)
  QUESTION:  'QUESTION',   // ? (value, unary)
  DOT:       'DOT',        // . (switch prefix)
  NEWLINE:   'NEWLINE',    // end of line
  EOF:       'EOF',
};

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  const len = source.length;
  // Each token records whether whitespace came before it: Zgrass reads
  // "SKIP -4" as a command with an argument and "SKIP-4" as a subtraction
  let spaced = false;
  const push = tokens.push.bind(tokens);
  tokens.push = (t) => { t.spaceBefore = spaced; spaced = false; return push(t); };

  while (i < len) {
    const ch = source[i];

    // Skip spaces, tabs and other blanks (but not newlines)
    if (ch !== '\n' && ch !== '\r' && /\s/.test(ch)) {
      spaced = true;
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
    // Actually in GRASS, . at start of a line is a comment but .B/.F are switches.
    // We'll handle . as DOT token and let the parser figure it out.

    // Numbers (including decimals, and .5 with no 0 before the point, as in
    // RT/1's glossary: B=B+.02). A . before a letter is a switch or a comment
    if ((ch >= '0' && ch <= '9') || (ch === '.' && isDigit(source[i + 1]))) {
      let num = '';
      while (i < len && ((source[i] >= '0' && source[i] <= '9') || source[i] === '.')) {
        // Don't consume . if it's followed by a letter (it's a switch like .B)
        if (source[i] === '.' && i + 1 < len && source[i + 1] >= 'A' && source[i + 1] <= 'Z') break;
        if (source[i] === '.' && i + 1 < len && source[i + 1] >= 'a' && source[i + 1] <= 'z') break;
        num += source[i];
        i++;
      }
      // Check if this number is immediately followed by letters (label like 1UP)
      if (i < len && isIdentStart(source[i]) && num[0] !== '.') {
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

    // ; then . starts a comment that runs to the end of the line, blanks
    // allowed between: LINE 6,-70,1;.THIS LINE HAS A COMMENT (RT/1 glossary,
    // COMMENT; BASIC Zgrass 1978's ;.get name). The ; still ends the
    // statement, and the newline is kept
    if (ch === ';') {
      let j = i + 1;
      while (j < len && (source[j] === ' ' || source[j] === '\t')) j++;
      if (source[j] === '.') {
        tokens.push({ type: TokenType.SEMI, value: ';' });
        while (j < len && source[j] !== '\n' && source[j] !== '\r') j++;
        i = j;
        continue;
      }
    }

    // Two-character operators. RT/1's table (GLOB.C op_tab) also has =< and
    // => for <= and >=, && and || for AND and OR
    const two = source.slice(i, i + 2);
    const pair = {
      '==': [TokenType.EQ, '=='], '=<': [TokenType.LE, '<='], '=>': [TokenType.GE, '>='],
      '&&': [TokenType.AND, 'AND'], '||': [TokenType.OR, 'OR'],
    }[two];
    if (pair) {
      tokens.push({ type: pair[0], value: pair[1] });
      i += 2;
      continue;
    }
    // Single = is assignment, as in Zgrass, and == is equality. The parser
    // reads = as equality only where its left side can't be assigned to.
    // : also assigns
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
      case '#': tokens.push({ type: TokenType.NE, value: '<>' }); break;
      case '!': tokens.push({ type: TokenType.BANG, value: '!' }); break;
      case '@': tokens.push({ type: TokenType.AT, value: '@' }); break;
      case '?': tokens.push({ type: TokenType.QUESTION, value: '?' }); break;
      default:
        // RT/1's "unknown character in expression" (ER_DKCH), rather than
        // reading the line as if the character weren't there
        throw new Error(`Unknown character in expression: ${ch}`);
    }
    i++;
  }

  tokens.push({ type: TokenType.EOF, value: null });
  return tokens;
}

function isDigit(ch) {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

// A name may hold a $ after its first character (QUANTIZED$SECOND$DEGREE)
function isIdentChar(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '$';
}
