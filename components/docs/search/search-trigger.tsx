"use client";

import { useCallback, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useCmdK } from "@/hooks/use-cmd-k";
import { SearchDialog } from "./search-dialog";

export function SearchTrigger({ version }: { version: string }) {
  const [open, setOpen] = useState(false);

  // useCmdK は handler を deps に取るので useCallback で安定化させる。
  useCmdK(useCallback(() => setOpen(true), []));

  // モバイルでは幅を食う検索バーを 9x9 の虫眼鏡アイコンに畳み、ナビリンクの表示領域を空ける。
  // sm 以上では従来どおり placeholder と ⌘K を持つ横長バーに展開する。同じダイアログを開く。
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search docs"
        className="inline-flex h-9 w-9 items-center justify-center border border-border transition-all hover:border-border-strong hover:cursor-text sm:w-full sm:max-w-65 sm:justify-start sm:gap-2 sm:px-3 sm:text-sm sm:text-muted-foreground"
      >
        <SearchIcon className="size-4 text-muted-foreground sm:text-inherit" />
        <span className="hidden flex-1 text-left sm:block"></span>
        <kbd className="hidden px-1.5 py-0.5 text-sm sm:inline">⌘K</kbd>
      </button>
      <SearchDialog version={version} open={open} onOpenChange={setOpen} />
    </>
  );
}
