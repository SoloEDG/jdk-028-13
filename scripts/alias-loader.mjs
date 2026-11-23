import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve as resolvePath, dirname } from "node:path";
import { statSync } from "node:fs";

function tryFile(path) {
  const candidates = [`${path}.ts`, `${path}.tsx`, resolvePath(path, "index.ts")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // 候选不存在，继续尝试
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const path = resolvePath(process.cwd(), "src", specifier.slice(2));
    const found = tryFile(path);
    if (found)
      return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
    const base = dirname(fileURLToPath(context.parentURL));
    const found = tryFile(resolvePath(base, specifier));
    if (found)
      return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

// 纯逻辑测试不挂载组件：把 .vue 导入替换成空模块
export async function load(url, context, nextLoad) {
  if (url.endsWith(".vue"))
    return { format: "module", source: "export default {};", shortCircuit: true };
  return nextLoad(url, context);
}
