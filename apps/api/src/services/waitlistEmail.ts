/** Transactional approval templates; the locale is captured on the public request. */
const templates: Record<
  string,
  { subject: string; intro: string; instructions: string }
> = {
  en: {
    subject: "Your Cinakey early access is approved",
    intro: "You can now join Cinakey.",
    instructions:
      "Sign up using this email address with an email code or your verified Google account.",
  },
  fr: {
    subject: "Votre accès anticipé à Cinakey est approuvé",
    intro: "Vous pouvez maintenant rejoindre Cinakey.",
    instructions:
      "Inscrivez-vous avec cette adresse e-mail, à l’aide d’un code reçu par e-mail ou de votre compte Google vérifié.",
  },
  es: {
    subject: "Tu acceso anticipado a Cinakey está aprobado",
    intro: "Ya puedes unirte a Cinakey.",
    instructions:
      "Regístrate con esta dirección de correo mediante un código por correo o tu cuenta de Google verificada.",
  },
  ko: {
    subject: "Cinakey 얼리 액세스가 승인되었습니다",
    intro: "이제 Cinakey에 가입할 수 있습니다.",
    instructions:
      "이 이메일 주소로 이메일 인증 코드 또는 인증된 Google 계정을 사용하여 가입하세요.",
  },
  ja: {
    subject: "Cinakeyの早期アクセスが承認されました",
    intro: "Cinakeyをご利用いただけるようになりました。",
    instructions:
      "このメールアドレスで、メール認証コードまたは確認済みのGoogleアカウントを使用して登録してください。",
  },
  zh: {
    subject: "您的 Cinakey 早期访问申请已获批准",
    intro: "您现在可以加入 Cinakey。",
    instructions:
      "请使用此邮箱地址，通过邮件验证码或已验证的 Google 账户注册。",
  },
};
export function approvalEmail(locale: string, link: string) {
  const template = templates[locale] ?? templates.en!;
  return {
    subject: template.subject,
    text: `${template.intro}\n\n${link}\n\n${template.instructions}\n\n— Cinakey`,
  };
}
