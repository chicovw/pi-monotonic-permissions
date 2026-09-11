import { basename } from 'node:path';

export const unsupportedMessages = {
  UNSUPPORTED_PIPELINE: 'Pipelines are not supported. Request separate supported operations.',
  UNSUPPORTED_REDIRECTION: 'Shell redirection is not supported. Request a supported native file operation.',
  UNSUPPORTED_COMMAND_CHAIN: 'Command chains/control operators are not supported. Request separate operations.',
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

export interface Command { argv: string[]; categories: string[]; inspection: boolean; scan?: { path: string; recursive: boolean } }

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
      if (c === '|' && command[i + 1] !== '|') throw new UnsupportedOperation('UNSUPPORTED_PIPELINE');
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

function git(argv: string[]): Command {
  const [_, operation, ...args] = argv;
  const result: Command = { argv, categories: [], inspection: false };
  if (!operation || operation.startsWith('-')) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
  // This new validation form requires an exact ordinary-policy entry, not the
  // legacy inspection default. Extra options/pathspecs remain unsupported.
  if (operation === 'diff' && args.length === 1 && args[0] === '--check') return result;
  // Unsupported global options, aliases and overrides cannot hide a hard category.
  if (['status', 'diff', 'log', 'show'].includes(operation)) {
    if (args.some(a => a.startsWith('-') && !['--short', '--porcelain', '--stat', '--name-only', '--oneline', '--no-patch', '--no-ext-diff', '--no-textconv', '--', '-1'].includes(a))) throw new UnsupportedOperation('UNSUPPORTED_GIT_FORM');
    result.inspection = true;
    return result;
  }
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

export function classify(command: string, depth = 0): Command[] {
  const argv = words(command);
  const executable = basename(argv[0]);
  if (['sh', 'bash'].includes(executable)) {
    if (depth >= 1 || argv.length !== 3 || argv[1] !== '-c') throw new UnsupportedOperation('UNSUPPORTED_SHELL_WRAPPER');
    // Retain wrapper as unknown too; knowing its inner category is not an executable grant.
    return [{ argv, categories: [], inspection: false }, ...classify(argv[2], depth + 1)];
  }
  if (['env', 'command', 'exec', 'eval', 'source', '.', 'cd', 'builtin'].includes(executable)) throw new UnsupportedOperation('UNSUPPORTED_SHELL_WRAPPER');
  if (executable === 'git') return [git(argv)];
  // Only bare executable spelling and bounded literal forms gain catalogue ALLOW.
  if (argv[0] === 'ls') {
    const args = argv.slice(1);
    if (['-l', '-a', '-la', '-al'].includes(args[0])) args.shift();
    if (args.length <= 1 && (!args[0] || !args[0].startsWith('-')))
      return [{ argv, categories: [], inspection: true, scan: { path: args[0] ?? '.', recursive: false } }];
  }
  if (argv[0] === 'rg') {
    const args = argv.slice(1);
    while (['-n', '-i', '-F'].includes(args[0])) args.shift();
    if (args.length === 2 && args.every(a => a && !a.startsWith('-')))
      return [{ argv, categories: [], inspection: true, scan: { path: args[1], recursive: true } }];
  }
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
  return [{ argv, categories, inspection: argv.length === 1 && executable === 'pwd' }];
}
