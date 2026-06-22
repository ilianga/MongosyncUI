import { MigrationForm } from "@/components/migration-form";

export default function NewMigrationPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Migration</h1>
      <MigrationForm />
    </div>
  );
}
