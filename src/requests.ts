import { classify, UnsupportedOperation } from './bash.ts';
import { normalize, requireReadable, resolveTarget } from './paths.ts';
import type { Action, Operation } from './policy.ts';
import type { ToolInfo } from '@earendil-works/pi-coding-agent';
import { describeCustom } from './custom-tools.ts';

export interface Request { toolName: string; toolCallId: string; input: Record<string, unknown> }
function shape(input: unknown, keys: string[], required: string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => !keys.includes(k)) || required.some(k => !(k in input))) throw new Error('TOOL_SHAPE');
}
function text(value: unknown): asserts value is string { if (typeof value !== 'string') throw new Error('TOOL_SHAPE'); }
function number(value: unknown): void { if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new Error('TOOL_SHAPE'); }

export async function describe(request: Request, cwd: string, info?: ToolInfo): Promise<Action> {
  if (typeof request.toolCallId !== 'string' || !request.toolCallId) throw new Error('TOOL_SHAPE');
  const input = request.input;
  const action: Action = { tool: request.toolName, targets: [] };
  if (request.toolName === 'bash') {
    shape(input, ['command', 'timeout'], ['command']); text(input.command); number(input.timeout);
    action.commands = classify(input.command);
    // Recognized literal rm destinations also receive native-style write restrictions.
    for (const command of action.commands) {
      if (command.argv[0].split('/').pop() === 'rm') {
        let operands = false;
        for (const arg of command.argv.slice(1)) {
          if (!operands && arg === '--') { operands = true; continue; }
          if (!operands && arg.startsWith('-')) continue;
          action.targets.push({ target: await resolveTarget(arg, cwd, true), operations: ['write'] });
        }
      }
    }
    return action;
  }
  let operations: Operation[];
  if (request.toolName === 'read') {
    shape(input, ['path', 'offset', 'limit'], ['path']); number(input.offset); number(input.limit);
    operations = ['read'];
  } else if (request.toolName === 'grep') {
    shape(input, ['pattern', 'path', 'glob', 'ignoreCase', 'literal', 'context', 'limit'], ['pattern', 'path']);
    text(input.pattern);
    if (input.glob !== undefined) text(input.glob);
    for (const k of ['ignoreCase', 'literal']) if (input[k] !== undefined && typeof input[k] !== 'boolean') throw new Error('TOOL_SHAPE');
    if (input.context !== undefined && (typeof input.context !== 'number' || !Number.isInteger(input.context) || input.context < 0)) throw new Error('TOOL_SHAPE');
    number(input.limit); operations = ['read'];
  } else if (request.toolName === 'write') {
    shape(input, ['path', 'content'], ['path', 'content']); text(input.content); operations = ['write'];
  } else if (request.toolName === 'edit') {
    shape(input, ['path', 'edits'], ['path', 'edits']);
    if (!Array.isArray(input.edits) || !input.edits.length) throw new Error('TOOL_SHAPE');
    for (const edit of input.edits) { shape(edit, ['oldText', 'newText'], ['oldText', 'newText']); text(edit.oldText); text(edit.newText); }
    operations = ['read', 'write', 'edit'];
  } else {
    // These are native Pi surfaces whose filesystem/process semantics remain unsupported.
    if (['find', 'ls', 'powershell'].includes(request.toolName)) throw new UnsupportedOperation('UNSUPPORTED_TOOL');
    return describeCustom(request, info);
  }
  text(input.path); normalize(input.path, cwd);
  const target = await resolveTarget(input.path, cwd, request.toolName === 'write');
  if (target.directory) throw new Error('REGULAR_FILE_REQUIRED');
  if (operations.includes('read')) await requireReadable(target);
  action.targets.push({ target, operations });
  for (const parent of target.parents) action.targets.push({ target: parent, operations: ['write'] });
  return action;
}
