export function publicFailure(error) {
  const raw = `${error?.code || ''} ${error?.message || error || ''}`.toLowerCase();
  if (/abort|cancel|중지/.test(raw))
    return { code: 'cancelled', message: '실행을 중지했습니다. 저장된 근거는 남아 있습니다.' };
  if (
    error?.code === 'auth' ||
    /401|invalid_grant|unauthorized|token.*expired|authentication|credential|refresh.*failed|no api key/.test(
      raw,
    )
  )
    return {
      code: 'auth',
      message: '계정 연결을 다시 확인해야 합니다. 로그인 후 이 단계부터 재개할 수 있습니다.',
    };
  if (/429|quota|rate.limit|usage.limit|too many/.test(raw))
    return { code: 'quota', message: '계정 사용 한도에 도달했습니다. 시간이 지난 뒤 재개하세요.' };
  if (/403|forbidden|not.*access|model.*not.*found|not.*supported|subscription/.test(raw))
    return {
      code: 'access',
      message: '이 계정으로 선택한 모델을 사용할 수 없습니다. 모델 또는 계정을 확인하세요.',
    };
  if (/fetch|network|econn|enotfound|socket|timeout|timed out/.test(raw))
    return {
      code: 'network',
      message: '연결이 완료되지 않았습니다. 네트워크 상태를 확인한 뒤 재시도하세요.',
    };
  if (/\b50[0234]\b|overloaded|service unavailable/.test(raw))
    return { code: 'transient', message: '서비스가 일시적으로 응답하지 않았습니다.' };
  return {
    code: 'runtime',
    message:
      '실행을 완료하지 못했습니다. 저장된 근거를 확인하고 이 단계를 다시 실행할 수 있습니다.',
  };
}

// Never copy upstream OAuth/HTTP errors to renderer, audit, or session records.
export function redact(text) {
  return String(text)
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[비공개 키 제외]',
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      '[인증정보 제외]',
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'\r\n}]+/gi,
      '$1[비공개 값 제외]',
    );
}
