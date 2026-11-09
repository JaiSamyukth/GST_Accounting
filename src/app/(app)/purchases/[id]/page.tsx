"use client";

import { use } from "react";
import { PurchaseEditor } from "@/components/purchase-editor";
import { Err, Loading, useLoad } from "@/components/ui";

type Existing = NonNullable<Parameters<typeof PurchaseEditor>[0]["existing"]>;

export default function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useLoad<Existing>(`/api/purchases/${encodeURIComponent(id)}`);
  if (error) return <Err error={error} />;
  if (!data) return <Loading />;
  return <PurchaseEditor existing={data} />;
}
