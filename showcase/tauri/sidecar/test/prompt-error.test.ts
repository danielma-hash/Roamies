import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { TaskRunError } from '../task-run-error.js';

it('the real prompt catch reports the original failure and releases busy state', async () => {
  const source = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const module = ts.createSourceFile('sidekick.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const prompt = module.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'prompt');
  expect(prompt).toBeDefined();
  const failure = new Error('fixture response failed'); const events: unknown[] = [];
  const format = vi.fn(() => ({ text: 'השירות לא השלים את התשובה.' }));
  const finish = vi.fn(async () => {});
  const context = vm.createContext({
    readyAgent: async () => null, busy: false, quiet: false, autoTurn: null, holdWake: () => {}, intro: null,
    shuttingDown: false, TaskRunError, taskRuns: { start: async () => {}, finish },
    activity: { asked: () => {}, stopped: () => [] }, menu: () => {}, AbortController,
    agent: { setSignal: () => {} }, controller: null, ui: (event: unknown) => events.push(event),
    VOICE_ON: () => false, speech: { stop: () => {} }, turnVoice: null,
    EchoFilter: function () {}, ReplyStream: function () { throw failure; },
    problem: format, aloud: (problem: { text: string }) => problem.text,
    PROVIDER_LABELS: { fixture: 'Fixture' }, config: { provider: 'fixture' },
    console: { error: () => {} }, lastFailed: false, syncSession: () => {}, lastInput: null, session: null,
  });
  await vm.runInContext(`${prompt!.getText(module)}; prompt('fixture request', null, '', false, 'fixture-task')`, context);
  expect(finish).toHaveBeenCalledWith('fixture-task', 'failed');
  expect(format).toHaveBeenCalledWith('reply', failure, { who: 'Fixture' });
  expect(events).toContainEqual({ kind: 'agent', e: { type: 'error', message: 'השירות לא השלים את התשובה.', speech: null } });
  expect(context.busy).toBe(false); expect(context.lastFailed).toBe(true);
});
