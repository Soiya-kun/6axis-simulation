type Expression = (t: number) => number;
const functions: Record<string, { arity: number; fn: (...args: number[]) => number }> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  atan2: { arity: 2, fn: Math.atan2 },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  exp: { arity: 1, fn: Math.exp },
  log: { arity: 1, fn: Math.log },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
};
// A small arithmetic parser: no eval, property access, assignments, or JavaScript execution.
export function compileExpression(source: string): Expression {
  if (!source.trim() || source.length > 512) throw new Error('式は1〜512文字で入力してください');
  const tokens =
    source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|\*\*|[^\s]/g) ??
    [];
  let index = 0;
  const peek = () => tokens[index];
  function expression(minimum = 0): Expression {
    let left: Expression;
    const token = tokens[index++];
    if (token === '+' || token === '-') {
      const rhs = expression(3);
      left = (t) => (token === '-' ? -rhs(t) : rhs(t));
    } else if (token === '(') {
      left = expression();
      if (tokens[index++] !== ')') throw new Error('閉じ括弧 ) が必要です');
    } else if (token === 't') left = (t) => t;
    else if (token === 'pi' || token === 'PI') left = () => Math.PI;
    else if (token === 'e') left = () => Math.E;
    else if (token && /^\d|^\.\d/.test(token) && Number.isFinite(Number(token)))
      left = () => Number(token);
    else if (Object.hasOwn(functions, token ?? '')) {
      const { arity, fn } = functions[token];
      if (tokens[index++] !== '(') throw new Error(`${token} の後に ( が必要です`);
      const args = [expression()];
      while (peek() === ',') {
        index++;
        args.push(expression());
      }
      if (tokens[index++] !== ')' || args.length !== arity)
        throw new Error(`${token} には${arity}個の引数が必要です`);
      left = (t) => fn(...args.map((a) => a(t)));
    } else throw new Error(`使用できない記号・変数: ${token ?? '式の末尾'}`);
    while (true) {
      const op = peek(),
        precedence =
          op === '+' || op === '-'
            ? 1
            : op === '*' || op === '/' || op === '%'
              ? 2
              : op === '^' || op === '**'
                ? 4
                : -1;
      if (precedence < minimum) break;
      index++;
      const right = expression(precedence + (precedence === 4 ? 0 : 1)),
        previous = left;
      left = (t) => {
        const a = previous(t),
          b = right(t);
        return op === '+'
          ? a + b
          : op === '-'
            ? a - b
            : op === '*'
              ? a * b
              : op === '/'
                ? a / b
                : op === '%'
                  ? a % b
                  : a ** b;
      };
    }
    return left;
  }
  const evaluate = expression();
  if (index !== tokens.length) throw new Error(`式を解釈できません: ${peek()}`);
  return (t) => {
    const value = evaluate(t);
    if (!Number.isFinite(value) || Math.abs(value) > 1e8)
      throw new Error(`t=${t.toFixed(4)} で式の値が非有限または範囲外です`);
    return value;
  };
}
