"use client";
// Create a key, then show it once with the setup for each assistant filled in.
import { ActionForm, FormInput, FormSelect } from "@/components/action-form";
import type { CreatedKey } from "@/server/agent/keys";
import { createKeyAction } from "./actions";
import { CopyBlock, SetupSnippets, type SnippetPlaces } from "./setup-snippets";

export function CreateKey({ places }: { places: SnippetPlaces }) {
  return (
    <ActionForm
      action={createKeyAction}
      submitLabel="Create key"
      pendingLabel="Creating key..."
      testId="create-key"
      renderResult={(data) => {
        const created = data as CreatedKey | undefined;
        if (!created?.secret) return null;
        return (
          <div
            className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2 p-4"
            data-testid="new-key"
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Your new key</p>
              <CopyBlock code={created.secret} label="Copy key" testId="new-key-secret" />
              <p className="text-xs text-ink-3">
                Shown only once. Anyone with it can read your plan until you revoke it, so keep it private.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Next: connect your assistant</p>
              <SetupSnippets places={places} secret={created.secret} />
            </div>
          </div>
        );
      }}
    >
      <FormInput
        name="name"
        label="Name"
        defaultValue="Claude"
        maxLength={60}
        hint="So you can tell your keys apart, for example Claude Desktop or Codex."
      />
      <FormSelect
        name="access"
        label="What it can do"
        defaultValue="read"
        hint="With changes, it can make what-if scenarios, set budgets and debt rates, and answer spending-review questions. It can never change your baseline plan, delete data or move money."
      >
        <option value="read">Read only (recommended)</option>
        <option value="write">Read and make changes</option>
      </FormSelect>
      <FormSelect name="expires" label="Stops working after" defaultValue="90">
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365">1 year</option>
        <option value="never">Never</option>
      </FormSelect>
    </ActionForm>
  );
}
