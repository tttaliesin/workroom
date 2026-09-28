export async function authorize(control, command, args) {
  const p = control.review({ command, args });
  const review = await control.run('review.submit', {
    packageId: p.id,
    verdict: 'supported',
    assessment: 'Reviewed the exact fixture content and its checks.',
    limitations: 'Local fixture only.',
    files: (p.evidence.find((e) => e.kind === 'change-set')?.changes || []).map((f) => ({
      path: f.path,
      hash: f.afterHash,
    })),
  });
  const decision = await control.run('review.decide', {
    reviewId: review.id,
    choice: 'execute',
    authority: { basis: 'user_instruction', reference: 'Explicit fixture instruction' },
  });
  return { reviewHash: p.packageHash, reviewId: review.id, decisionId: decision.id };
}
