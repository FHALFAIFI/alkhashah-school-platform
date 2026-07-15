import "server-only";
import { generateSecret, generateURI, verifySync } from "otplib";

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, username: string): string {
  return generateURI({
    secret,
    label: username,
    issuer: "منصة الإدارة المدرسية المتكاملة",
  });
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token, secret, epochTolerance: 1 });
    return result.valid === true;
  } catch {
    return false;
  }
}
