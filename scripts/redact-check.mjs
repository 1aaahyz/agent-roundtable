/** 验证 security.ts 的 redact() 脱敏规则覆盖常见密钥形态。 */
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/lib/security.ts", import.meta.url), "utf8");
// 从源码里抽出 redact 的三条 replace 规则并直接执行，确保测的是真实实现
const body = src.slice(src.indexOf("export function redact"), src.indexOf("const SAFE_LINK_PROTOCOLS"))
  .replace("export function redact(text: string): string", "function redact(text)")
  .trim();
const fn = new Function(`${body}; return redact;`)();

const cases = [
  ["Authorization 头", "Authorization: Bearer sk-abcdef1234567890", "sk-abcdef1234567890"],
  ["裸 sk- 密钥", "key is sk-abcdef1234567890 here", "sk-abcdef1234567890"],
  ["JSON api_key", '{"api_key":"sk-xyz-long-enough","password":"hunter2"}', "hunter2"],
  ["tp- Token Plan 密钥", "token=tp-1234567890abcd", "tp-1234567890abcd"],
];
let pass = 0, fail = 0;
for (const [name, input, secret] of cases) {
  const out = fn(input);
  const ok = !out.includes(secret);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name} -> ${out}`);
}
console.log(`\n脱敏检查：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
