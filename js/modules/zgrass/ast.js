// ast.js — AST node type definitions for the ZGRASS parser

// Literal number
export function NumLit(value) {
  return { type: 'NumLit', value };
}

// Literal string
export function StrLit(value) {
  return { type: 'StrLit', value };
}

// Variable reference (global A-Z start, local a-z start, device $XX)
export function VarRef(name) {
  return { type: 'VarRef', name };
}

// Array element reference: name(index) or name(row,col)
export function ArrayRef(name, indices) {
  return { type: 'ArrayRef', name, indices };
}

// Assignment: VAR:expr or (VAR:expr)
export function Assign(name, expr) {
  return { type: 'Assign', name, expr };
}

// Array element assignment: name(index):expr
export function ArrayAssign(name, indices, expr) {
  return { type: 'ArrayAssign', name, indices, expr };
}

// Binary operation: +, -, *, /, \(mod), %(random), &(concat), ==, <, >, <=, >=, !=
export function BinOp(op, left, right) {
  return { type: 'BinOp', op, left, right };
}

// Unary operation: - (negation), NOT
export function UnaryOp(op, operand) {
  return { type: 'UnaryOp', op, operand };
}

// Command call: COMMAND arg1,arg2,...
// Also used for function calls (SIN, COS, etc.) and macro invocation
export function Command(name, args, switches) {
  return { type: 'Command', name, args: args || [], switches: switches || [] };
}

// A line that is a label followed by commands: 1UP BOX ...
export function LabeledLine(label, commands) {
  return { type: 'LabeledLine', label, commands };
}

// A sequence of statements on one line separated by ;
export function Sequence(stmts) {
  return { type: 'Sequence', stmts };
}

// IF condition, rest-of-line
export function IfStmt(condition, body) {
  return { type: 'IfStmt', condition, body };
}

// Parenthesized expression (may contain assignment)
export function Paren(expr) {
  return { type: 'Paren', expr };
}
