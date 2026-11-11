// parser.js — Recursive descent: tokens -> AST
// GRASS grammar:
//   line = [label] statement { ";" statement }
//   statement = assignment | if_stmt | command_call
//   assignment = IDENT ("=" | ":") expr
//   if_stmt = "IF" expr "," rest_of_line
//   command_call = IDENT [switches] [arglist]
//   arglist = expr { "," expr } | "(" expr { "," expr } ")"
//   expr = lvalue ("=" | ":") expr | or
//   comparison = addition { ("==" | "<" | ">" | "<=" | ">=" | "!=") addition }
//   addition = multiplication { ("+" | "-") multiplication }
//   multiplication = unary { ("*" | "/" | "\" | "%" | "&") unary }
//   unary = ["-" | "NOT"] primary
//   primary = NUMBER | STRING | paren_expr | DEVICE | var_or_call
//   paren_expr = "(" [assignment | expr] ")"
//   var_or_call = IDENT ["(" arglist ")"] [":=" expr]

import { TokenType } from './tokenizer.js';
import * as AST from './ast.js';

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: null };
  }

  advance() {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  expect(type) {
    const t = this.peek();
    if (t.type !== type) {
      throw new Error(`Expected ${type} but got ${t.type} (${t.value})`);
    }
    return this.advance();
  }

  match(type) {
    if (this.peek().type === type) {
      return this.advance();
    }
    return null;
  }

  atEnd() {
    const t = this.peek();
    return t.type === TokenType.EOF;
  }

  atLineEnd() {
    const t = this.peek();
    return t.type === TokenType.EOF || t.type === TokenType.NEWLINE;
  }

  // Parse entire input (may be multiple lines)
  parseProgram() {
    const lines = [];
    while (!this.atEnd()) {
      // Skip blank lines
      while (this.match(TokenType.NEWLINE)) {}
      if (this.atEnd()) break;
      lines.push(this.parseLine());
    }
    if (lines.length === 1) return lines[0];
    return AST.Sequence(lines);
  }

  // Parse a single line: [label] statement { ";" statement }
  parseLine() {
    const stmts = [];
    stmts.push(this.parseStatement());

    while (this.match(TokenType.SEMI)) {
      if (this.atLineEnd() || this.atEnd()) break;
      stmts.push(this.parseStatement());
    }

    // Consume trailing newline
    this.match(TokenType.NEWLINE);

    if (stmts.length === 1) return stmts[0];
    return AST.Sequence(stmts);
  }

  // Parse a single statement
  parseStatement() {
    if (this.atLineEnd() || this.atEnd()) {
      return AST.NumLit(0); // empty statement
    }

    const t = this.peek();

    // Check for IF
    if (t.type === TokenType.IDENT && t.value.toUpperCase() === 'IF') {
      return this.parseIf();
    }

    // Check for assignment: IDENT ":" or DEVICE ":"
    if ((t.type === TokenType.IDENT || t.type === TokenType.DEVICE) && this.isAssignment()) {
      return this.parseAssignment();
    }

    // Otherwise it's a command call or bare expression
    if (t.type === TokenType.IDENT) {
      return this.parseCommandOrExpr();
    }

    // Bare expression
    return this.parseExpr();
  }

  // Look ahead to check if this is an assignment (IDENT ":")
  isAssignment() {
    // Save position, look ahead
    const save = this.pos;
    this.advance(); // skip IDENT/DEVICE

    // Skip optional array indices
    if (this.peek().type === TokenType.LPAREN) {
      let depth = 0;
      while (this.pos < this.tokens.length) {
        const tt = this.peek().type;
        if (tt === TokenType.LPAREN) depth++;
        else if (tt === TokenType.RPAREN) { depth--; if (depth === 0) { this.advance(); break; } }
        this.advance();
      }
    }

    const isAssign = isAssignOp(this.peek());
    this.pos = save;
    return isAssign;
  }

  parseAssignment() {
    const nameToken = this.advance();
    const name = nameToken.value;

    // Check for array indices
    let indices = null;
    if (this.peek().type === TokenType.LPAREN) {
      this.advance(); // skip (
      indices = [this.parseExpr()];
      while (this.match(TokenType.COMMA)) {
        indices.push(this.parseExpr());
      }
      this.expect(TokenType.RPAREN);
    }

    if (!isAssignOp(this.peek())) {
      const t = this.peek();
      throw new Error(`Expected = but got ${t.type} (${t.value})`);
    }
    this.advance();
    const expr = this.parseExpr();

    if (indices) {
      return AST.ArrayAssign(name, indices, expr);
    }
    return AST.Assign(name, expr);
  }

  parseIf() {
    this.advance(); // skip IF

    // Parse condition expression
    const condition = this.parseExpr();

    // Expect comma after condition
    this.expect(TokenType.COMMA);

    // Parse rest of line as body (sequence of ; separated statements)
    const stmts = [];
    if (!this.atLineEnd() && !this.atEnd()) {
      stmts.push(this.parseStatement());
      while (this.match(TokenType.SEMI)) {
        if (this.atLineEnd() || this.atEnd()) break;
        stmts.push(this.parseStatement());
      }
    }

    const body = stmts.length === 1 ? stmts[0] : AST.Sequence(stmts);
    return AST.IfStmt(condition, body);
  }

  // Parse either a command call (IDENT args...) or an expression starting with IDENT
  parseCommandOrExpr() {
    const t = this.peek();
    const name = t.value;

    // Look ahead: if next token after IDENT is an operator or end, treat as expression
    const save = this.pos;
    this.advance(); // consume IDENT

    // Check for switches (.B, .F, .CRT, etc.)
    const switches = [];
    while (this.peek().type === TokenType.DOT) {
      this.advance(); // skip .
      if (this.peek().type === TokenType.IDENT) {
        switches.push(this.advance().value.toUpperCase());
      }
    }

    const next = this.peek();

    // If followed by colon, it's actually an assignment (shouldn't reach here, but safety)
    if (next.type === TokenType.COLON) {
      this.pos = save;
      return this.parseAssignment();
    }

    // If at end of statement, it's a no-arg command or variable ref
    if (next.type === TokenType.SEMI || next.type === TokenType.NEWLINE ||
        next.type === TokenType.EOF || next.type === TokenType.RPAREN ||
        next.type === TokenType.COMMA) {
      // No-arg command or variable reference
      if (switches.length > 0) {
        return AST.Command(name, [], switches);
      }
      // Could be a variable reference in expression context, but at statement level
      // treat it as a command call (which can also be a macro invocation)
      return AST.Command(name, [], []);
    }

    // If followed by an operator, this is part of an expression, except for a
    // spaced minus that starts an argument: SKIP -4, LINE -X,-Y,1
    if (isOperator(next.type) && !this.startsSpacedArg(this.pos)) {
      this.pos = save;
      return this.parseExpr();
    }

    // Otherwise, parse as command with arguments
    this.pos = save;
    this.advance(); // skip IDENT again

    // Re-consume switches
    switches.length = 0;
    while (this.peek().type === TokenType.DOT) {
      this.advance();
      if (this.peek().type === TokenType.IDENT) {
        switches.push(this.advance().value.toUpperCase());
      }
    }

    const args = this.parseArgList();
    return AST.Command(name, args, switches);
  }

  // Parse comma-separated argument list
  parseArgList() {
    const args = [];
    if (this.atLineEnd() || this.atEnd() || this.peek().type === TokenType.SEMI) {
      return args;
    }

    // Arguments in parentheses: PRINT(10,20,30). A single parenthesized
    // argument parses the same either way, and (5*2)+3 is an expression
    if (this.peek().type === TokenType.LPAREN) {
      const save = this.pos;
      try {
        this.advance();
        const list = [this.parseExpr()];
        while (this.match(TokenType.COMMA)) list.push(this.parseExpr());
        this.expect(TokenType.RPAREN);
        const t = this.peek().type;
        if (list.length > 1 && (t === TokenType.SEMI || t === TokenType.NEWLINE ||
            t === TokenType.EOF || t === TokenType.RPAREN || t === TokenType.COMMA)) {
          return list;
        }
      } catch (e) { /* not a parenthesized list */ }
      this.pos = save;
    }

    args.push(this.parseExpr());
    while (this.match(TokenType.COMMA)) {
      args.push(this.parseExpr());
    }
    return args;
  }

  // Expression parsing (precedence climbing)
  // Assignment is an expression, lowest in precedence and right to left, so
  // PRINT A=10%100, BOX X=X+20,0,18,18,3 and IF (N=N+1)<10 all assign. A =
  // after something that can't be assigned to is taken as equality
  parseExpr() {
    const left = this.parseOr();
    if (!isAssignOp(this.peek())) return left;
    if (left.type === 'VarRef') {
      this.advance();
      return AST.Assign(left.name, this.parseExpr());
    }
    if (left.type === 'ArrayRef') {
      this.advance();
      return AST.ArrayAssign(left.name, left.indices, this.parseExpr());
    }
    if (this.peek().type === TokenType.EQ) {
      this.advance();
      return AST.BinOp('==', left, this.parseExpr());
    }
    return left;
  }

  // A minus with a space before it and none after starts an argument
  startsSpacedArg(pos) {
    const t = this.tokens[pos];
    const n = this.tokens[pos + 1];
    return Boolean(t && n && t.type === TokenType.MINUS && t.spaceBefore && !n.spaceBefore);
  }

  // Can the token at pos begin a command's first argument? A command name
  // followed by a space and an argument calls it: P P 10 is PRINT(PRINT(10))
  startsArg(pos) {
    const t = this.tokens[pos];
    if (!t || !t.spaceBefore) return false;
    return t.type === TokenType.NUMBER || t.type === TokenType.STRING ||
      t.type === TokenType.IDENT || t.type === TokenType.DEVICE ||
      t.type === TokenType.NOT || this.startsSpacedArg(pos);
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek().type === TokenType.OR) {
      this.advance();
      const right = this.parseAnd();
      left = AST.BinOp('OR', left, right);
    }
    return left;
  }

  parseAnd() {
    let left = this.parseComparison();
    while (this.peek().type === TokenType.AND) {
      this.advance();
      const right = this.parseComparison();
      left = AST.BinOp('AND', left, right);
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAddition();
    while (true) {
      const t = this.peek();
      // A single = is left to parseExpr, which assigns
      if ((t.type === TokenType.EQ && t.value === '==') || t.type === TokenType.LT || t.type === TokenType.GT ||
          t.type === TokenType.LE || t.type === TokenType.GE || t.type === TokenType.NE) {
        const op = this.advance().value;
        const right = this.parseAddition();
        left = AST.BinOp(op, left, right);
      } else {
        break;
      }
    }
    return left;
  }

  parseAddition() {
    let left = this.parseMultiplication();
    while (true) {
      const t = this.peek();
      if (t.type === TokenType.PLUS || t.type === TokenType.MINUS) {
        const op = this.advance().value;
        const right = this.parseMultiplication();
        left = AST.BinOp(op, left, right);
      } else {
        break;
      }
    }
    return left;
  }

  parseMultiplication() {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t.type === TokenType.STAR || t.type === TokenType.SLASH ||
          t.type === TokenType.BACKSLASH || t.type === TokenType.PERCENT ||
          t.type === TokenType.AMP) {
        const op = this.advance().value;
        const right = this.parseUnary();
        left = AST.BinOp(op, left, right);
      } else {
        break;
      }
    }
    return left;
  }

  parseUnary() {
    if (this.peek().type === TokenType.MINUS) {
      this.advance();
      const operand = this.parseUnary();
      return AST.UnaryOp('-', operand);
    }
    if (this.peek().type === TokenType.NOT) {
      this.advance();
      const operand = this.parseUnary();
      return AST.UnaryOp('NOT', operand);
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.peek();

    // Number literal
    if (t.type === TokenType.NUMBER) {
      this.advance();
      return AST.NumLit(t.value);
    }

    // String literal
    if (t.type === TokenType.STRING) {
      this.advance();
      return AST.StrLit(t.value);
    }

    // Device variable
    if (t.type === TokenType.DEVICE) {
      this.advance();
      // Check for assignment
      if (this.peek().type === TokenType.COLON) {
        this.advance();
        const expr = this.parseExpr();
        return AST.Assign(t.value, expr);
      }
      return AST.VarRef(t.value);
    }

    // Parenthesized expression (may contain assignment)
    if (t.type === TokenType.LPAREN) {
      this.advance();

      // Check if it's a parenthesized assignment (IDENT ":" expr)
      if ((this.peek().type === TokenType.IDENT || this.peek().type === TokenType.DEVICE) &&
          this.pos + 1 < this.tokens.length) {
        const save = this.pos;
        const nameToken = this.advance();

        // Check for array indices before colon
        let indices = null;
        if (this.peek().type === TokenType.LPAREN) {
          let depth = 0;
          while (this.pos < this.tokens.length) {
            const tt = this.peek().type;
            if (tt === TokenType.LPAREN) depth++;
            else if (tt === TokenType.RPAREN) { depth--; if (depth === 0) { this.advance(); break; } }
            this.advance();
          }
        }

        if (this.peek().type === TokenType.COLON) {
          this.pos = save;
          const nameT = this.advance();

          // Parse array indices
          indices = null;
          if (this.peek().type === TokenType.LPAREN) {
            this.advance();
            indices = [this.parseExpr()];
            while (this.match(TokenType.COMMA)) {
              indices.push(this.parseExpr());
            }
            this.expect(TokenType.RPAREN);
          }

          this.expect(TokenType.COLON);
          const expr = this.parseExpr();
          this.expect(TokenType.RPAREN);

          if (indices) {
            return AST.Paren(AST.ArrayAssign(nameT.value, indices, expr));
          }
          return AST.Paren(AST.Assign(nameT.value, expr));
        }
        this.pos = save;
      }

      const expr = this.parseExpr();
      this.expect(TokenType.RPAREN);
      return AST.Paren(expr);
    }

    // Identifier — variable reference or function call in expression context
    if (t.type === TokenType.IDENT) {
      this.advance();

      // Function-style call: IDENT(args)
      if (this.peek().type === TokenType.LPAREN) {
        const save = this.pos;
        this.advance(); // skip (

        // Could be array reference or function call
        const args = [];
        if (this.peek().type !== TokenType.RPAREN) {
          args.push(this.parseExpr());
          while (this.match(TokenType.COMMA)) {
            args.push(this.parseExpr());
          }
        }
        this.expect(TokenType.RPAREN);

        // Check if it's an array assignment: IDENT(idx):expr
        if (this.peek().type === TokenType.COLON) {
          this.advance();
          const expr = this.parseExpr();
          return AST.ArrayAssign(t.value, args, expr);
        }

        // It's either an array ref or function call — resolver decides
        return AST.ArrayRef(t.value, args);
      }

      // A name, a space, then an argument: a call nested in an expression
      if (this.startsArg(this.pos)) {
        return AST.Command(t.value, this.parseArgList(), []);
      }

      return AST.VarRef(t.value);
    }

    // Nothing matched — error
    if (t.type === TokenType.EOF || t.type === TokenType.NEWLINE) {
      return AST.NumLit(0);
    }

    throw new Error(`Unexpected token: ${t.type} (${t.value})`);
  }
}

function isOperator(type) {
  return type === TokenType.PLUS || type === TokenType.MINUS ||
         type === TokenType.STAR || type === TokenType.SLASH ||
         type === TokenType.BACKSLASH || type === TokenType.PERCENT ||
         type === TokenType.AMP || type === TokenType.EQ ||
         type === TokenType.LT || type === TokenType.GT ||
         type === TokenType.LE || type === TokenType.GE ||
         type === TokenType.NE || type === TokenType.AND ||
         type === TokenType.OR || type === TokenType.COLON;
}

// = or : between a name and its value
function isAssignOp(t) {
  return t.type === TokenType.COLON || (t.type === TokenType.EQ && t.value === '=');
}

// Convenience function
export function parse(tokens) {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}
