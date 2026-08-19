import { useState } from "react";
import { Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAccessUsers, saveAccessUser } from "@/lib/hr.functions";
import type { AccessUser, ViewerRole } from "@/lib/hr-types";

const ROLE_LABEL: Record<ViewerRole, string> = {
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

export function AdminAccessPanel() {
  const loadUsers = useServerFn(listAccessUsers);
  const saveUser = useServerFn(saveAccessUser);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ViewerRole>("employee");
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [saving, setSaving] = useState(false);

  const users = useQuery<AccessUser[]>({
    queryKey: ["access-users"],
    queryFn: () => loadUsers(),
    staleTime: 30_000,
  });

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveUser({
        data: {
          email,
          role,
          employeeId: employeeId || undefined,
          employeeName: employeeName || undefined,
        },
      });
      toast.success("Access profile saved", {
        description: `${email.toLowerCase()} can now create an account as ${ROLE_LABEL[role]}.`,
      });
      setEmail("");
      setEmployeeId("");
      setEmployeeName("");
      await users.refetch();
    } catch (error) {
      toast.error("Could not save access profile", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel mb-8 space-y-5 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Access management</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Approve an email before the person uses <strong>Create account</strong>. Employee and manager records can be linked by Employee ID or exact name.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto] lg:items-end">
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Email
          <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@decorlab.in" />
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as ViewerRole)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="employee">Employee</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Employee ID
          <Input value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="DLB-SUP-01" />
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          Employee name
          <Input value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Exact Employee Master name" />
        </label>
        <Button type="submit" variant="gold" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Save access
        </Button>
      </form>

      {users.isLoading ? <p className="text-xs text-muted-foreground">Loading access list…</p> : null}
      {users.error ? <p className="text-xs text-danger">{users.error instanceof Error ? users.error.message : "Could not load access list."}</p> : null}
      {users.data?.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Employee link</th>
                <th className="px-3 py-2 font-medium">Account action</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id} className="border-t border-border/70">
                  <td className="px-3 py-2 font-medium">{user.email}</td>
                  <td className="px-3 py-2 text-primary">{ROLE_LABEL[user.role] ?? user.role}</td>
                  <td className="px-3 py-2 text-muted-foreground">{user.employeeName || user.employeeId || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">Use Create account on the sign-in page</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
