"use client";

import { use } from "react";
import { SaleEditor, type SaleExisting } from "@/components/sale-editor";
import { Err, Loading, useLoad } from "@/components/ui";

export default function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useLoad<SaleExisting>(`/api/sales/${encodeURIComponent(id)}`);
  if (error) return <Err error={error} />;
  if (!data) return <Loading />;
  return <SaleEditor key={data.doc.id} existing={data} />;
}
