import LegalPage, { A, H, Table } from "@/components/legal/LegalPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cookie Notice" };

export default function Cookies() {
  return (
    <LegalPage title="Cookie Notice" subtitle="What small files Vaulte puts on your device, and why.">
      <p>Vaulte uses only the cookie that is strictly necessary to keep you signed in. Such cookies do not need consent under the EU ePrivacy rules, the UK Privacy and Electronic Communications Regulations, or similar laws, so we do not show a cookie banner. We do not use advertising, analytics, social-media or tracking cookies or pixels, and we do not track you across other websites. If we ever add any, this page and a consent choice will change first.</p>
      <Table head={["Name", "Purpose", "Lifetime", "Type"]} rows={[
        ["vaulte_session", "Keeps you signed in. Contains a signed token that refers to a server-side session you can revoke from your account. HttpOnly, Secure, SameSite=Lax.", "Until you sign out, or the session expires", "Essential, first-party"],
      ]} />
      <H>Local storage</H>
      <p>Your browser may remember small interface choices (for example a selected tab or a draft you have not sent) in local storage on your device. This is never sent to us or used to track you, and you can clear it in your browser.</p>
      <H>Controlling cookies</H>
      <p>You can block or delete cookies in your browser settings, but you will not be able to sign in without the session cookie. Questions: see the <A href="/legal/privacy">Privacy Policy</A>.</p>
    </LegalPage>
  );
}
