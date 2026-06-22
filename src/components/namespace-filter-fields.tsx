"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import type { MigrationFormValues } from "@/lib/schemas";

export function NamespaceFilterFields({
  control,
  register,
  name,
  label,
}: {
  control: Control<MigrationFormValues>;
  register: UseFormRegister<MigrationFormValues>;
  name: "includeNamespaces" | "excludeNamespaces";
  label: string;
}) {
  const fa = useFieldArray({ control, name });
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {fa.fields.map((field, i) => (
        <div key={field.id} className="space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input placeholder="database" {...register(`${name}.${i}.database`)} />
            <Input placeholder="collections (comma-separated)" {...register(`${name}.${i}.collections`)} />
            <Button type="button" variant="outline" size="sm" onClick={() => fa.remove(i)}>X</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="databaseRegex (optional)" {...register(`${name}.${i}.databaseRegex`)} />
            <Input placeholder="collectionsRegex (optional)" {...register(`${name}.${i}.collectionsRegex`)} />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fa.append({ database: "", collections: "", databaseRegex: "", collectionsRegex: "" })}
      >
        Add {label} row
      </Button>
    </div>
  );
}
