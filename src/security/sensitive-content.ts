const PASSWORD_PATTERN =
  /\b(password|passcode|pin|secret|token|api[_ -]?key|access[_ -]?token)\b|密碼|密码|金鑰|金钥/i;
const TAIWAN_ID_PATTERN = /\b[A-Z][12]\d{8}\b/i;
const CARD_LIKE_PATTERN = /(?:\d[ -]?){13,19}/;

export function isSensitiveContent(text: string): boolean {
  if (PASSWORD_PATTERN.test(text)) {
    return true;
  }

  if (TAIWAN_ID_PATTERN.test(text)) {
    return true;
  }

  return hasCardLikeDigits(text);
}

function hasCardLikeDigits(text: string): boolean {
  const matches = text.match(new RegExp(CARD_LIKE_PATTERN, "g")) ?? [];

  return matches.some((match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19;
  });
}
