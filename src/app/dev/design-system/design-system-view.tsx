"use client";

import * as React from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeSegmented } from "@/components/layout/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FoundationsSection } from "./sections/foundations";
import { ControlsSection } from "./sections/controls";
import { DisplaySection } from "./sections/display";
import { FeedbackSection } from "./sections/feedback";

export function DesignSystemView() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-(--z-topbar) border-b border-border bg-surface-topbar">
        <div className="mx-auto flex h-14 max-w-(--content-max-width) items-center gap-4 px-4 sm:px-6">
          <BrandLogo height={26} />
          <div className="min-w-0">
            <h1 className="truncate text-h4 font-semibold text-fg">Design System</h1>
            <p className="truncate text-caption text-fg-muted">Referência interna · ambiente de desenvolvimento</p>
          </div>
          <div className="ml-auto">
            <ThemeSegmented />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-(--content-max-width) px-4 py-6 sm:px-6">
        <Tabs defaultValue="foundations">
          <TabsList className="mb-5">
            <TabsTrigger value="foundations">Fundamentos</TabsTrigger>
            <TabsTrigger value="controls">Controles</TabsTrigger>
            <TabsTrigger value="display">Exibição de dados</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
          </TabsList>

          <TabsContent value="foundations">
            <FoundationsSection />
          </TabsContent>
          <TabsContent value="controls">
            <ControlsSection />
          </TabsContent>
          <TabsContent value="display">
            <DisplaySection />
          </TabsContent>
          <TabsContent value="feedback">
            <FeedbackSection />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/** Shared layout for every specimen block on this page. */
export function Specimen({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-h4 font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-body-sm text-fg-secondary">{description}</p> : null}
      </div>
      <div className={className ?? "flex flex-wrap items-start gap-3"}>{children}</div>
    </section>
  );
}
