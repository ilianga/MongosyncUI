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
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      {fa.fields.map((field, i) => (
        <div key={field.id} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <Input
              placeholder="database"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.database`)}
            />
            <Input
              placeholder="collections"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.collections`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => fa.remove(i)}
              aria-label="Remove row"
            >
              ×
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              placeholder="databaseRegex (optional)"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.databaseRegex`)}
            />
            <Input
              placeholder="collectionsRegex (optional)"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.collectionsRegex`)}
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-dashed text-muted-foreground hover:text-foreground"
        onClick={() => fa.append({ database: "", collections: "", databaseRegex: "", collectionsRegex: "" })}
      >
        + Add {label} row
      </Button>
    </div>
  );
}
