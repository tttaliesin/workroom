import { t, getLanguage } from '../shared/i18n.mjs';
import { captureCodexEvent } from '../integrations/codex-capture.mjs';
export const coreMethods = new Set([
  'snapshot',
  'changes',
  'createProduct',
  'updateProduct',
  'inspect',
  'addRecord',
  'toggleRecord',
  'requestDecision',
  'resolveDecision',
  'deferDecision',
  'reportWork',
  'createPortfolio',
  'savePortfolio',
  'saveJobSource',
  'context',
  'setCodexCapture',
  'changeWorkLink',
  'reviewRecord',
  'reviewPortfolioSource',
]);
export function createCommands({ room, getEngine, getBroker, publications, publishVault, shell }) {
  return {
    capture: (method, args) => {
      if (method !== 'event') throw new Error('Unknown capture command');
      return captureCodexEvent(room, args.productId, args.event);
    },
    core: async (method, args = {}, actor = 'user') => {
      const engine = getEngine();
      if (!coreMethods.has(method)) throw new Error(t('지원하지 않는 작업입니다.'));
      if (method === 'snapshot')
        return {
          ...room.snapshot(),
          language: getLanguage(),
          runtime: engine?.info() || { state: 'starting' },
          portfolioReadiness: Object.fromEntries(
            room.store
              .list('portfolio')
              .map((p) => [
                p.id,
                engine?.editor.readiness(p) || { ready: false, blockers: ['starting'] },
              ]),
          ),
          agentRuns: room.store.list('agent-run'),
          agentEvidence: room.store.list('agent-evidence'),
          agentContexts: room.store.list('agent-context'),
          agentChanges: room.store.list('change-set'),
          applyJournals: room.store.list('apply-journal'),
          publicationDestinations: room.store.list('publication-destination'),
          publicationAccount: publishVault.status(),
          publications: room.store.list('publication').map(({ html, ...p }) => p),
          reviewPackages: room.store.list('review-package').map(({ evidence, args, ...p }) => ({
            ...p,
            targetId: args.id || args.productId || args.portfolioId,
          })),
          reviewRecords: room.store.list('review-record'),
          executionDecisions: room.store.list('execution-decision'),
        };
      const result = await room[method](args, actor);
      if (method === 'resolveDecision') engine?.recovery.tick();
      return result;
    },
    runtime: async (method, args = {}, _actor, context = {}) => {
      const engine = getEngine(),
        broker = getBroker();
      if (!engine) throw new Error(t('내장 실행기를 준비하고 있습니다.'));
      if (method === 'configure') return engine.configure(args);
      if (method === 'configureOperations') return engine.operations.configure(args);
      if (method === 'configureVerification') return engine.profiles.save(args);
      if (method === 'checkOperations')
        return engine.operations.observe({ productId: args.productId, manual: true });
      if (method === 'issueAction') return engine.operations.act(args);
      if (method === 'editPortfolio')
        return engine.editor.request({ portfolioId: args.portfolioId });
      if (method === 'configurePortfolioEditor') return engine.editor.configure(args);
      if (method === 'applyPortfolioEdit') return engine.editor.apply(args);
      if (method === 'start') return engine.start(args);
      if (method === 'resume') return engine.resume(args);
      if (method === 'stop') return engine.stop(args);
      if (method === 'applyChange') return engine.changes.apply(args, context);
      if (method === 'tick') return engine.operations.tick();
      if (method === 'restart') {
        if (broker.child) throw new Error(t('실행기가 연결되어 있습니다.'));
        await broker.start();
        return engine.info();
      }
      if (method === 'logout' && !broker.child) {
        broker.vault.write(null);
        await broker.start();
        return engine.info();
      }
      if (!['login', 'cancelLogin', 'manualCode', 'logout', 'verify'].includes(method))
        throw new Error(t('지원하지 않는 실행 요청입니다.'));
      if (['login', 'logout', 'verify'].includes(method) && engine.active.size)
        throw new Error(t('진행 중인 작업을 먼저 중지하세요.'));
      if (method === 'login' && !['browser', 'device_code'].includes(args.mode))
        throw new Error(t('로그인 방법을 선택하세요.'));
      if (method === 'login') {
        // Logging in replaces the saved login, so one that can no longer be decrypted is dropped and
        // the runner is started here rather than asking the user to find another button first.
        if (!broker.child && broker.status.failure?.unreadable) broker.vault.write(null);
        await broker.ensure();
      }
      if (method === 'verify') args = { modelId: engine.settings.modelId };
      return broker.request(method, args);
    },
    external: async (method, args, _actor, context) => {
      if (method !== 'submit') throw new Error('Unknown external command');
      return getEngine().changes.submitExternal(args, context);
    },
    publication: async (method, args = {}) => {
      if (method === 'credentials') {
        if (typeof args.token !== 'string' || args.token.length < 10 || args.token.length > 1000)
          throw new Error(t('유효한 Vercel 토큰을 입력하세요.'));
        publishVault.write({ type: 'oauth', access: args.token, refresh: '' });
        room.store.log('공개 계정 변경', 'publication');
        return { saved: true };
      }
      if (method === 'disconnect') {
        publishVault.write(null);
        room.store.log('공개 계정 변경', 'publication');
        return { saved: false };
      }
      if (method === 'configure') return publications.configure(args);
      if (method === 'prepare') {
        const { html, ...p } = publications.prepare({ ...args, language: getLanguage() });
        return p;
      }
      if (method === 'publish') {
        const { html, ...p } = await publications.publish(args);
        return p;
      }
      if (method === 'reconcile') {
        const { html, ...p } = await publications.reconcile(args);
        return p;
      }
      if (method === 'open') {
        const p = room.store.get('publication', args.id);
        if (!p.url || !/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(p.url))
          throw new Error('Invalid public URL');
        await shell.openExternal(p.url);
        return;
      }
      throw new Error(t('지원하지 않는 작업입니다.'));
    },
  };
}
