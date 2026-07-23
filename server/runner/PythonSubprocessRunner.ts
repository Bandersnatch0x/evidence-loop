import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { isPythonRunnerSpec } from '../data/assignments'
import type { CodeRunner, RunnerRequest, RunnerResult } from './types'
import { resolveSubmission } from './types'

const MAX_OUTPUT_BYTES = 64 * 1024

export const PYTHON_HARNESS = String.raw`
import ast
import contextlib
import io
import json
import math
import sys

sys.stdout.reconfigure(encoding="utf-8")

payload = json.loads(sys.stdin.read())
code = payload["code"]
function_name = payload["functionName"]
max_ast_nodes = payload["maxAstNodes"]

banned_nodes = (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)
banned_calls = {
    "breakpoint", "compile", "delattr", "eval", "exec", "getattr",
    "globals", "help", "input", "locals", "open", "setattr", "vars",
    "__import__"
}

try:
    tree = ast.parse(code, mode="exec")
except SyntaxError as error:
    print(json.dumps({
        "status": "rejected",
        "reason": f"语法错误：第 {error.lineno or '?'} 行 {error.msg}",
        "evidence": []
    }, ensure_ascii=False))
    raise SystemExit(0)

for node in ast.walk(tree):
    if isinstance(node, banned_nodes):
        print(json.dumps({
            "status": "rejected",
            "reason": "本地演示运行器不允许导入模块或修改全局作用域。",
            "evidence": []
        }, ensure_ascii=False))
        raise SystemExit(0)
    if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
        print(json.dumps({
            "status": "rejected",
            "reason": "本地演示运行器不允许访问双下划线属性。",
            "evidence": []
        }, ensure_ascii=False))
        raise SystemExit(0)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in banned_calls:
        print(json.dumps({
            "status": "rejected",
            "reason": f"本地演示运行器不允许调用 {node.func.id}。",
            "evidence": []
        }, ensure_ascii=False))
        raise SystemExit(0)

safe_builtins = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "Exception": Exception,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "print": print,
    "range": range,
    "round": round,
    "set": set,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "TypeError": TypeError,
    "ValueError": ValueError,
    "zip": zip
}
namespace = {"__builtins__": safe_builtins}
captured = io.StringIO()

try:
    with contextlib.redirect_stdout(captured):
        exec(compile(tree, "<student-submission>", "exec"), namespace, namespace)
except Exception as error:
    print(json.dumps({
        "status": "rejected",
        "reason": f"加载提交失败：{type(error).__name__}: {error}",
        "evidence": []
    }, ensure_ascii=False))
    raise SystemExit(0)

target = namespace.get(function_name)
evidence = []
function_exists = callable(target)
evidence.append({
    "id": "required-function",
    "state": "passed" if function_exists else "failed",
    "message": "目标函数可调用" if function_exists else "目标函数不存在或不可调用"
})

module_output = captured.getvalue()
captured.seek(0)
captured.truncate(0)

for case in payload["testCases"]:
    if not function_exists:
        evidence.append({
            "id": case["id"],
            "state": "blocked",
            "message": "目标函数缺失，测试未执行"
        })
        continue

    try:
        with contextlib.redirect_stdout(captured):
            actual = target(*case["args"])
        expected = case["expected"]
        if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
            passed = math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)
        else:
            passed = actual == expected
        evidence.append({
            "id": case["id"],
            "state": "passed" if passed else "failed",
            "actual": repr(actual),
            "message": "结果符合预期" if passed else "结果与预期不一致"
        })
    except Exception as error:
        evidence.append({
            "id": case["id"],
            "state": "failed",
            "actual": type(error).__name__,
            "message": f"执行失败：{type(error).__name__}: {error}"
        })

runtime_output = captured.getvalue()
has_output = bool((module_output + runtime_output).strip())
evidence.append({
    "id": "no-side-effects",
    "state": "failed" if has_output else "passed",
    "actual": (module_output + runtime_output)[:200] if has_output else None,
    "message": "检测到标准输出" if has_output else "未检测到标准输出"
})

node_count = sum(1 for _ in ast.walk(tree))
is_focused = node_count <= max_ast_nodes
evidence.append({
    "id": "focused-function",
    "state": "passed" if is_focused else "failed",
    "actual": str(node_count),
    "message": "实现规模合理" if is_focused else f"抽象语法树节点数 {node_count} 超过建议值 {max_ast_nodes}"
})

print(json.dumps({"status": "completed", "evidence": evidence}, ensure_ascii=False))
`

interface PythonSubprocessRunnerOptions {
  pythonBin?: string
  timeoutMs?: number
}

export class PythonSubprocessRunner implements CodeRunner {
  public readonly name = 'python-subprocess'

  private readonly pythonBin: string
  private readonly timeoutMs: number

  public constructor(options: PythonSubprocessRunnerOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? 'python'
    this.timeoutMs = options.timeoutMs ?? 1_500
  }

  public run(request: RunnerRequest): Promise<RunnerResult> {
    const startedAt = performance.now()

    return new Promise((resolve) => {
      const runnerSpec = request.assignment.runner
      if (!isPythonRunnerSpec(runnerSpec)) {
        resolve(
          this.failedResult(
            startedAt,
            'Python subprocess runner requires a PythonRunnerSpec (questionType: code).'
          )
        )
        return
      }

      let child: ChildProcessWithoutNullStreams

      try {
        child = spawn(this.pythonBin, ['-I', '-S', '-u', '-c', PYTHON_HARNESS], {
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1'
          },
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (error) {
        resolve(this.failedResult(startedAt, this.errorMessage(error)))
        return
      }

      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (result: RunnerResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }

      const timeout = setTimeout(() => {
        child.kill()
        finish(
          this.failedResult(
            startedAt,
            `提交运行超过 ${this.timeoutMs}ms，已终止。本地演示运行器不接受无限循环或长任务。`
          )
        )
      }, this.timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > MAX_OUTPUT_BYTES) {
          child.kill()
          finish(this.failedResult(startedAt, '运行器输出超过安全上限，任务已终止。'))
        }
      })

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        if (stderr.length > MAX_OUTPUT_BYTES) {
          child.kill()
          finish(this.failedResult(startedAt, '运行器错误输出超过安全上限，任务已终止。'))
        }
      })

      child.on('error', (error) => {
        finish(this.failedResult(startedAt, this.errorMessage(error)))
      })

      child.on('close', (exitCode) => {
        if (settled) return

        if (exitCode !== 0) {
          finish(
            this.failedResult(
              startedAt,
              stderr.trim() || `Python 运行器异常退出，退出码 ${String(exitCode)}。`
            )
          )
          return
        }

        try {
          const output = JSON.parse(stdout) as Omit<RunnerResult, 'durationMs'>
          finish({
            ...output,
            durationMs: Math.max(1, Math.round(performance.now() - startedAt))
          })
        } catch {
          finish(this.failedResult(startedAt, '无法解析运行器结果。'))
        }
      })

      child.stdin.end(
        JSON.stringify({
          code: resolveSubmission(request),
          functionName: runnerSpec.functionName,
          maxAstNodes: runnerSpec.maxAstNodes,
          testCases: runnerSpec.testCases
        })
      )
    })
  }

  private failedResult(startedAt: number, reason: string): RunnerResult {
    return {
      status: 'failed',
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      evidence: [],
      reason
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return `找不到 Python 运行时“${this.pythonBin}”，请设置 PYTHON_BIN。`
    }

    return error instanceof Error ? error.message : '无法启动 Python 运行器。'
  }
}
