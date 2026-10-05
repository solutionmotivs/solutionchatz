import AcceptInviteClient from "@/components/auth/AcceptInviteClient";

export default function AcceptInvitePage({ searchParams }: { searchParams: { token?: string } }) {
  return <AcceptInviteClient token={searchParams.token ?? ""} />;
}
