import { redirect } from "next/navigation";

// Per Jira SCRUM-7 (T-107): visiting /register without a role redirects home.
export default function RegisterIndexPage() {
  redirect("/");
}
