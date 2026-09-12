import { basename } from 'node:path';

export const unsupportedMessages = {
  UNSUPPORTED_PIPELINE: 'This pipeline contains an unsupported stage. Use only reviewed read-only inspection stages.',
  UNSUPPORTED_REDIRECTION: 'Shell redirection is not supported. Request a supported native file operation.',
  UNSUPPORTED_COMMAND_CHAIN: 'This command chain contains an unsupported operation. Use only reviewed read-only inspection commands.',
  UNSUPPORTED_SUBSTITUTION: 'Shell substitution/expansion is not supported. Use literal arguments.',
  UNSUPPORTED_BACKGROUND_EXECUTION: 'Background execution is not supported.',
  UNSUPPORTED_SHELL_SYNTAX: 'This shell syntax is outside the supported literal-command subset.',
  UNSUPPORTED_SHELL_WRAPPER: 'This shell wrapper is outside the supported one-level literal sh -c subset.',
  UNSUPPORTED_GIT_FORM: 'This Git operation or option form is not supported by the classifier.',
  UNSUPPORTED_PACKAGE_FORM: 'This package command option form cannot be classified safely.',
  UNSUPPORTED_RM_FORM: 'This deletion option form cannot be classified safely.',
  INSPECTION_LIMIT: 'Inspection exceeds the bounded preflight limit. Request a narrower target.',
  UNSUPPORTED_TOOL: 'This tool is not supported by the permission evaluator.'
} as const;
export class UnsupportedOperation extends Error {
  readonly code: keyof typeof unsupportedMessages;
  constructor(code: keyof typeof unsupportedMessages) { super(unsupportedMessages[code]); this.code = code; }
}

export interface Command {
  argv: string[];
  categories: string[];
  /** A bounded, read-only command whose output is scoped to its targets/workspace. */
  inspection: boolean;
  /** A package validation command which is PUBLIC only with an exact global review. */
  validation?: boolean;
  scan?: { path: string; recursive: boolean; maxDepth?: number };
  /** Explicit regular files whose metadata or digest is exposed. */
  targets?: string[];
}

/** Recognizes only literal words. It does not attempt to parse general Bash. */
export function words(command: string): string[] {
  if (!command || /[\x00-\x1f\x7f]/.test(command)) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  const argv: string[] = [];
  let word = '', active = false, quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else {
        if (quote === '"' && /[$`]/.test(c)) throw new UnsupportedOperation('UNSUPPORTED_SUBSTITUTION');
        if (quote === '"' && c === '\\') throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
        word += c;
      }
    } else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (c === ' ') { if (active) { argv.push(word); word = ''; active = false; } }
    else {
      if (c === '>' || c === '<') throw new UnsupportedOperation('UNSUPPORTED_REDIRECTION');
      if (c === ';' || c === '|' || (c === '&' && command[i + 1] === '&')) throw new UnsupportedOperation('UNSUPPORTED_COMMAND_CHAIN');
      if (c === '&') throw new UnsupportedOperation('UNSUPPORTED_BACKGROUND_EXECUTION');
      if (c === '$' || c === '`') throw new UnsupportedOperation('UNSUPPORTED_SUBSTITUTION');
      if (!/[a-zA-Z0-9_./:@%+,=\-]/.test(c)) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
      word += c; active = true;
    }
  }
  if (quote) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  if (active) argv.push(word);
  if (!argv.length || !argv[0] || argv[0].includes('=')) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  return argv;
}

/** Split only top-level literal command composition. This is deliberately not a shell parser. */
function composition(command: string): { commands: string[]; operators: ('&&' | '||' | ';' | '|')[] } {
  if (!command || /[\x00-\x1f\x7f]/.test(command)) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  const commands: string[] = [], operators: ('&&' | '||' | ';' | '|')[] = [];
  let quote = '', start = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    const operator = command.startsWith('&&', i) ? '&&' : command.startsWith('||', i) ? '||' : c === ';' ? ';' : c === '|' ? '|' : undefined;
    if (!operator) continue;
    const segment = command.slice(start, i).trim();
    if (!segment) throw new UnsupportedOperation(operator === '|' ? 'UNSUPPORTED_PIPELINE' : 'UNSUPPORTED_COMMAND_CHAIN');
    commands.push(segment); operators.push(operator); i += operator.length - 1; start = i + 1;
  }
  if (quote) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  const tail = command.slice(start).trim();
  if (!tail) throw new UnsupportedOperation(operators.at(-1) === '|' ? 'UNSUPPORTED_PIPELINE' : 'UNSUPPORTED_COMMAND_CHAIN');
  commands.push(tail);
  return { commands, operators };
}

function git(argv: string[]): Command {
  const [_, operation, ...args] = argv;
  const result: Command = { argv, categories: [], inspection: false };
  if (!operation || operation.startsWith('-')) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
  // This new validation form requires an exact ordinary-policy entry, not the
  // legacy inspection default. Extra options/pathspecs remain unsupported.
  if (operation === 'diff' && args.length === 1 && args[0] === '--check') return { ...result, validation: true };
  // Unsupported global options, aliases and overrides cannot hide a hard category.
  const exact = (...forms: string[][]) => forms.some(form => JSON.stringify(args) === JSON.stringify(form));
  if (operation === 'status' && exact([], ['--short'], ['--porcelain'])) { result.inspection = true; return result; }
  if (operation === 'branch' && exact(['--show-current'])) { result.inspection = true; return result; }
  if (operation === 'diff' && exact([], ['--stat'], ['--name-only'], ['--no-ext-diff'], ['--no-textconv'])) { result.inspection = true; return result; }
  if (operation === 'log' && exact([], ['--oneline'], ['--oneline', '--decorate'], ['--decorate', '--oneline'], ['-1'])) { result.inspection = true; return result; }
  if (operation === 'show' && exact([], ['--no-patch'])) { result.inspection = true; return result; }
  if (operation === 'rev-parse') {
    if (args.length !== 1 || !['--show-toplevel', '--show-prefix', '--is-inside-work-tree', 'HEAD'].includes(args[0])) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    result.inspection = true; return result;
  }
  if (operation === 'push') {
    result.categories.push('gitPush');
    let positional = false;
    for (const arg of args) {
      if (!positional && arg === '--') { positional = true; continue; }
      if (!positional && arg.startsWith('-')) {
        if (arg === '--mirror') result.categories.push('gitForcePush', 'gitDeletePush');
        else if (arg === '--force' || arg === '--force-with-lease' || arg.startsWith('--force-with-lease=') || /^-[fduvn]+$/.test(arg)) {
          if (arg.startsWith('--force') || arg.includes('f')) result.categories.push('gitForcePush');
          if (!arg.startsWith('--') && arg.includes('d')) result.categories.push('gitDeletePush');
        } else if (arg === '--delete') result.categories.push('gitDeletePush');
        else if (!['--dry-run', '--verbose', '--quiet', '--tags', '--all', '--set-upstream', '--atomic', '--no-verify'].includes(arg)) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
      } else {
        if (arg.startsWith('+')) result.categories.push('gitForcePush');
        if (arg.startsWith(':') || arg.startsWith('+:')) result.categories.push('gitDeletePush');
      }
    }
  } else if (operation === 'reset') {
    if (args.some(a => a.startsWith('-') && a !== '--hard' && a !== '--')) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    if (!args.includes('--hard')) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    result.categories.push('gitResetHard');
  } else if (operation === 'clean') {
    if (args.some(a => a.startsWith('-') && a !== '--' && !/^-[fdnxX]+$/.test(a))) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    result.categories.push('gitClean');
  } else if (operation === 'branch' || operation === 'tag') {
    if (!args.some(a => a === '--delete' || /^-[dD]+$/.test(a))) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    if (args.some(a => a.startsWith('-') && a !== '--delete' && a !== '--' && !/^-[dDr]+$/.test(a))) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    result.categories.push('gitDeleteRef');
  } else if (['rebase', 'filter-branch', 'filter-repo'].includes(operation)) result.categories.push('gitRewrite');
  else throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
  return result;
}

function find(argv: string[]): Command {
  const args = argv.slice(1);
  const path = args.shift();
  if (!path || path.startsWith('-')) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  let maxDepth: number | undefined;
  let type: string | undefined;
  let name: string | undefined;
  while (args.length) {
    const option = args.shift();
    if (option === '-maxdepth') {
      const value = args.shift();
      if (!value || !/^[1-9][0-9]*$/.test(value) || Number(value) > 32 || maxDepth !== undefined) throw new UnsupportedOperation('INSPECTION_LIMIT');
      maxDepth = Number(value);
    } else if (option === '-type') {
      const value = args.shift();
      if (value !== 'f' || type !== undefined) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
      type = value;
    } else if (option === '-name') {
      const value = args.shift();
      if (!value || value.startsWith('-') || name !== undefined) throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
      name = value;
    } else throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
  }
  return { argv, categories: [], inspection: true, scan: { path, recursive: true, maxDepth } };
}

function stat(argv: string[]): Command {
  const args = argv.slice(1);
  if (args.length === 1 && !args[0].startsWith('-')) return { argv, categories: [], inspection: true, targets: args };
  if (args.length === 3 && args[0] === '-f' && args[1].startsWith('%') && !/[\x00-\x1f\x7f]/.test(args[1]) && !args[2].startsWith('-'))
    return { argv, categories: [], inspection: true, targets: [args[2]] };
  throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
}

function shasum(argv: string[]): Command {
  const args = argv.slice(1);
  if ((args.length === 1 && !args[0].startsWith('-')) || (args.length === 3 && args[0] === '-a' && args[1] === '256' && !args[2].startsWith('-')))
    return { argv, categories: [], inspection: true, targets: [args.at(-1)!] };
  throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
}

function rg(argv: string[]): Command {
  const args = argv.slice(1);
  if (args[0] === '--files') {
    args.shift();
    if (args.length <= 1 && (!args[0] || !args[0].startsWith('-'))) return { argv, categories: [], inspection: true, scan: { path: args[0] ?? '.', recursive: true } };
  }
  while (['-n', '-i', '-F'].includes(args[0])) args.shift();
  if (args.length === 2 && args.every(a => a && !a.startsWith('-')))
    return { argv, categories: [], inspection: true, scan: { path: args[1], recursive: true } };
  throw new UnsupportedOperation('UNSUPPORTED_SHELL_SYNTAX');
}

function single(commandText: string, depth: number): Command[] {
  const argv = words(commandText);
  const executable = basename(argv[0]);
  if (['sh', 'bash'].includes(executable)) {
    if (depth >= 1 || argv.length !== 3 || argv[1] !== '-c') throw new UnsupportedOperation('UNSUPPORTED_SHELL_WRAPPER');
    // Retain wrapper as unknown too; knowing its inner category is not an executable grant.
    return [{ argv, categories: [], inspection: false }, ...classify(argv[2], depth + 1)];
  }
  if (['env', 'command', 'exec', 'eval', 'source', '.', 'cd', 'builtin'].includes(executable)) throw new UnsupportedOperation('UNSUPPORTED_SHELL_WRAPPER');
  if (executable === 'git') return [git(argv)];
  if (executable === 'find') return [find(argv)];
  if (executable === 'stat') return [stat(argv)];
  if (executable === 'shasum') return [shasum(argv)];
  // Only bare executable spelling and bounded literal forms gain catalogue ALLOW.
  if (argv[0] === 'ls') {
    const args = argv.slice(1);
    if (['-l', '-a', '-la', '-al'].includes(args[0])) args.shift();
    if (args.length <= 1 && (!args[0] || !args[0].startsWith('-')))
      return [{ argv, categories: [], inspection: true, scan: { path: args[0] ?? '.', recursive: false } }];
  }
  if (argv[0] === 'rg') return [rg(argv)];
  if (executable === 'sort' && argv.length === 1) return [{ argv, categories: [], inspection: true }];
  if (executable === 'head' && (argv.length === 1 || (argv.length === 2 && /^-[1-9][0-9]*$/.test(argv[1]))
    || (argv.length === 3 && argv[1] === '-n' && /^[1-9][0-9]*$/.test(argv[2])))) return [{ argv, categories: [], inspection: true }];
  const categories: string[] = [];
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(executable)) {
    if (argv[1]?.startsWith('-')) throw new UnsupportedOperation('UNSUPPORTED_PACKAGE_FORM');
    if (argv[1] === 'publish' || (executable === 'yarn' && argv[1] === 'npm' && argv[2] === 'publish')) categories.push('packagePublish');
  }
  if ((executable === 'cargo' && argv[1] === 'publish') || (executable === 'twine' && argv[1] === 'upload')) categories.push('packagePublish');
  if (executable === 'rm') {
    if (argv.slice(1).some(a => a.startsWith('--') && !['--recursive', '--force', '--', '--verbose'].includes(a))) throw new UnsupportedOperation('UNSUPPORTED_RM_FORM');
    if (argv.slice(1).some(a => a === '--recursive' || /^-[a-zA-Z]*[rR]/.test(a))) categories.push('recursiveDelete');
  }
  if (['sudo', 'dd', 'mkfs', 'diskutil', 'shutdown', 'reboot'].includes(executable)) categories.push('systemDestructive');
  const validation = (executable === 'npm' && (JSON.stringify(argv.slice(1)) === JSON.stringify(['test'])
    || (argv[1] === 'run' && ['test', 'typecheck', 'lint', 'build'].includes(argv[2]) && argv.length === 3)));
  return [{ argv, categories, inspection: argv.length === 1 && executable === 'pwd', ...(validation ? { validation: true } : {}) }];
}

/**
 * Supports a deliberately small composition grammar. Every segment must already
 * be a recognized inspection command; this is not a general shell evaluator.
 */
export function classify(commandText: string, depth = 0): Command[] {
  const { commands, operators } = composition(commandText);
  const parsed = commands.flatMap(segment => single(segment, depth));
  if (!operators.length) return parsed;
  if (!parsed.every(item => item.inspection)) {
    throw new UnsupportedOperation(operators.includes('|') ? 'UNSUPPORTED_PIPELINE' : 'UNSUPPORTED_COMMAND_CHAIN');
  }
  return parsed;
}
