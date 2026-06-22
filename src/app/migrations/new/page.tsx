import { MigrationForm } from "@/components/migration-form";
import { Topbar } from "@/components/app-shell/topbar";

export default function NewMigrationPage() {
  return (
    <>
      <Topbar title="New Migration" />
      <div className="max-w-2xl animate-fade-in px-6 py-6">
        <MigrationForm />
      </div>
    </>
  );
}
