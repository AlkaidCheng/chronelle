"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type Ref,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { FieldCount } from "../../components/counted-field";
import { LinkIcon, SearchIcon } from "../../components/icons";
import { personInitials } from "../../lib/person-collection";
import { usePanelPlacement } from "../../lib/use-panel-placement";

/** An account the card can be linked to: the signed-in user's own, or a friend's. */
export interface LinkableAccount {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly relation: "you" | "friend";
}

/** How the card is linked: to the signed-in user, to a friend, or to another account. */
export type PersonLink = "you" | "friend" | "elsewhere";

/** At most this many accounts list under the field. */
const listedAtMost = 8;

/**
 * The person's Name field, which is also the account lookup: while it has
 * focus and the card is unlinked, the accounts the card can be linked to
 * list under it, the signed-in user's own pinned first and the friends
 * whose name or email matches the typed text after it. Picking one links
 * the card. Once linked, the field carries a mark at its right ("You" or
 * "Friend") whose clear unlinks and keeps the name.
 */
export function PersonNameField({
  accounts,
  disabled = false,
  inputRef,
  limit,
  link,
  onChange,
  onLink,
  onUnlink,
  value,
}: {
  readonly accounts: readonly LinkableAccount[];
  readonly disabled?: boolean;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly limit: number;
  readonly link: PersonLink | null;
  readonly onChange: (name: string) => void;
  readonly onLink: (account: LinkableAccount) => void;
  readonly onUnlink: () => void;
  readonly value: string;
}) {
  const t = useTranslations("person");
  const te = useTranslations("personEditor");
  const id = useId();
  const labelId = `${id}-label`;
  const countId = `${id}-count`;
  const listId = `${id}-list`;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().toLowerCase();
  const candidates = accounts
    .filter(
      (account) =>
        account.relation === "you" ||
        query === "" ||
        account.displayName.toLowerCase().includes(query) ||
        (account.email?.toLowerCase().includes(query) ?? false),
    )
    .slice(0, listedAtMost);
  const open = focused && !dismissed && link === null && candidates.length > 0;
  const activeAccount = open ? candidates[active] : undefined;
  const optionId = (index: number) => `${id}-option-${index}`;

  function pick(account: LinkableAccount) {
    setDismissed(true);
    setActive(-1);
    onLink(account);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + candidates.length) % candidates.length);
    } else if (event.key === "Enter" && activeAccount !== undefined) {
      event.preventDefault();
      pick(activeAccount);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setActive(-1);
    }
  }

  const relation = (account: LinkableAccount) =>
    account.relation === "you" ? t("you") : t("friend");
  const mark =
    link === null ? null : link === "elsewhere" ? te("linked") : t(link);
  return (
    <div className="field person-name-field">
      <span className="visually-hidden" id={labelId}>
        {te("name")}
      </span>
      <div className={`person-name-wrap${link === null ? "" : " is-linked"}`}>
        <input
          aria-activedescendant={
            activeAccount === undefined ? undefined : optionId(active)
          }
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-describedby={countId}
          aria-expanded={open}
          aria-labelledby={labelId}
          autoComplete="off"
          disabled={disabled}
          maxLength={limit}
          onBlur={() => {
            setFocused(false);
            setActive(-1);
          }}
          onChange={(event) => {
            setDismissed(false);
            setActive(-1);
            onChange(event.target.value.slice(0, limit));
          }}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          placeholder={te("name")}
          ref={inputRef}
          required
          role="combobox"
          value={value}
        />
        {mark === null ? (
          <SearchIcon className="person-name-lens" />
        ) : (
          <span className="person-link-mark">
            <LinkIcon className="person-link-mark-icon" />
            {mark}
            {link === "elsewhere" ? null : (
              <button
                aria-label={t("unlink")}
                className="person-link-clear"
                disabled={disabled}
                onClick={onUnlink}
                type="button"
              >
                &#215;
              </button>
            )}
          </span>
        )}
        {open ? (
          <AccountList
            accounts={candidates}
            active={active}
            id={listId}
            label={te("accounts")}
            onPick={pick}
            optionId={optionId}
            relation={relation}
          />
        ) : null}
      </div>
      <FieldCount id={countId} limit={limit} value={value} />
    </div>
  );
}

/**
 * The accounts under the field, as wide as the field and fixed to the
 * viewport like the editors' other panels, so the dialog's scrolling body
 * never clips them.
 */
function AccountList({
  accounts,
  active,
  id,
  label,
  onPick,
  optionId,
  relation,
}: {
  readonly accounts: readonly LinkableAccount[];
  readonly active: number;
  readonly id: string;
  readonly label: string;
  readonly onPick: (account: LinkableAccount) => void;
  readonly optionId: (index: number) => string;
  readonly relation: (account: LinkableAccount) => string;
}) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = list.current;
    const wrap = element?.parentElement;
    if (element && wrap) element.style.width = `${wrap.offsetWidth}px`;
  }, []);
  usePanelPlacement(list);
  return (
    <div
      aria-label={label}
      className="person-lookup"
      id={id}
      ref={list}
      role="listbox"
    >
      {accounts.map((account, index) => (
        <button
          aria-selected={index === active}
          className="person-lookup-option"
          id={optionId(index)}
          key={account.userId}
          onClick={() => onPick(account)}
          // The field keeps focus through the press, so the list stays open until the pick.
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          tabIndex={-1}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`person-avatar person-avatar-row${account.relation === "you" ? " person-avatar-linked" : ""}`}
          >
            {personInitials(account.displayName)}
          </span>
          <span className="person-lookup-who">
            <strong>{account.displayName}</strong>
            {account.email === null ? null : <small>{account.email}</small>}
          </span>
          <span className="person-lookup-relation">{relation(account)}</span>
        </button>
      ))}
    </div>
  );
}
