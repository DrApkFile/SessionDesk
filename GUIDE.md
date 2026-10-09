# SessionDesk: how to use it

This guide is in two halves. The first is for anyone in the community. The second is for the
people who run it. You do not need to know anything technical to follow either one.

- [For members](#for-members)
- [For managers](#for-managers)
- [Questions people ask](#questions-people-ask)

---

# For members

## What the bot is

It is an assistant in your community chat that actually remembers you. When you tell it about a
problem, it passes that to the team and then keeps track of what happens to it, so you can ask
later and get the real answer instead of "we'll look into it". When somebody else already asked
your question, it gives you the answer they got.

It does not guess. If it has nothing on record, it says so.

## Joining in

A manager posts a notice in the group and pins it. It has two buttons:

- **I agree** — the bot can remember what you tell it in the group.
- **I agree + DMs** — the same, and it may also message you privately when something you asked
  about changes.

Tap one. That is all. Nothing you said before you tapped is kept.

If you have not joined and you mention the bot, it replies with those same two buttons rather than
ignoring you.

## What it remembers, and what it never keeps

It remembers things you tell it: a problem you hit, an idea, an answer you gave someone, and facts
about yourself like your role or your timezone.

It does not keep anything that looks like a secret. If your message contains something like a key,
a seed phrase, a password or an email address, the whole message is refused and nothing is saved.
It tells you that it refused, so you are never left guessing.

It never tells one member anything about another member. If you ask about a specific person, it
says it does not share details about other members. It will tell you what the community has
raised, because that is shared, but never who raised it.

## Asking it things

- **In the group:** put `@` and its name in your message. It stays quiet otherwise, so it does not
  fill your chat.
- **In a direct message:** just type. It always answers there.

## When it reuses an old answer

If the team already answered your question, you get that answer, who gave it, the date, and a link
to the receipt on Walrus (the permanent storage it uses). Underneath it asks **"Did this help?"**

Reply **yes** or **no**. A no is passed to the team and opens nothing extra, so you are not
creating a duplicate report by saying it did not help.

## When it asks "is that what you mean?"

Sometimes your question looks very close to one that was answered before, but one important word
is different — you asked about `testnet SOL` and the answer on record is about `testnet SUI`.
Rather than give you an answer about the wrong thing, it asks:

> I have an answer about SUI. Is that what you mean, or are you asking about SOL?

Say **yes** and it shows you that answer. Say anything else and it answers the question you
actually asked. It deliberately does not show you the old answer until you say yes.

## Your commands

| Command | What it does | What you see |
|---|---|---|
| `/start` | Begins a private chat with the bot | What it keeps and what it refuses, before it keeps anything, with the buttons to agree |
| `/mydata` | Everything the bot holds about you | A numbered list, each line with its date and a receipt link, and a reminder that the lines stay on Walrus forever |
| `/correct 3 I am a designer` | Fixes line 3 of what `/mydata` showed | "Done, I have it as … now", and `/mydata` shows the new wording in a minute |
| `/help` | A short reminder of the above | The three things it does, and these commands |

`/correct` takes the **line number** from `/mydata`, not an id. You can correct something you told
it about yourself, or the wording of something you raised. You cannot correct a status — only a
manager changes those.

## Privacy, plainly

Everything saved goes on Walrus, which is permanent public storage. Your name and your Telegram id
are **not** stored: your memories live under a scrambled code made from your id, which cannot be
turned back into it.

Because Walrus is permanent, **a single memory cannot be deleted** — not by you, not by a manager,
not by the people who built this. `/correct` adds a correction that replaces the old line for
anything the bot does from then on, but the old line still exists. This is why it asks you to
agree before it keeps anything.

---

# For managers

## What the manager bot is

A second, separate bot. It is private on purpose: it can change statuses, read manager-only notes
and see what the community holds, and none of that belongs in a group chat. Send it commands in a
direct message. It only obeys people on its manager list.

If somebody who is not a manager taps one of its buttons, nothing happens and they get a small
private popup saying only managers can do that.

## Setting it up the first time

| Step | Command | What happens |
|---|---|---|
| 1 | `/claim <the code from your startup log>` | Makes you the owner. The code is printed once in the startup log and never shown again. First claim wins; there is no second. |
| 2 | *(add the member bot to your group as an admin)* | |
| 3 | `/setup` — sent **in the group** | Names that group as this community |
| 4 | `/optin` — sent **in the group** | The member bot posts and pins the notice members tap to join |
| — | `/addmanager 12345678` | Lets somebody else run manager commands. Reply to their message instead of typing an id if that is easier. |
| — | `/removemanager 12345678` | Takes that away again |

## Seeing what people are raising

| Command | What it does | What you see |
|---|---|---|
| `/themes` | What people are raising, open items only | Each report in one line — a snippet of what was said, its status in plain words, the date — with its id underneath, and buttons to move the first few on |
| `/themes 2` | The next page | 12 themes a page. The footer says `Page 2 of 4` |
| `/themes all` | Includes finished and closed items | The same, with fixed, verified, duplicate and won't fix included |
| `/themes all 3` | Page 3 of that fuller view | |

There is a **Show more** button at the bottom, and **Back** from page 2 on, so you can tap instead
of typing. Asking for a page past the end tells you how many there are.

The header counts both: `23 open, 41 closed, across 65 theme(s)`. Nothing is hidden silently.

## Handling what people raise

Every one of these takes an item id, which `/themes` prints under each report. A short id works as
long as it matches only one item.

| Command | What it does | What you see |
|---|---|---|
| `/ack i-ab12cd` | Tells the member the team has picked it up | Confirmation, and the member is told |
| `/fixed i-ab12cd` | Marks it fixed | Confirmation. Only possible once it is acknowledged |
| `/verify i-ab12cd` | Confirms somebody checked the fix | Confirmation |
| `/reopen i-ab12cd` | Reopens something marked fixed | Confirmation |
| `/duplicate i-ab12cd` | Closes it as already known | Confirmation |
| `/wontfix i-ab12cd` | Closes it as something that will not change | Confirmation |

**The buttons on `/themes` do the same thing with one tap**, and they only ever offer a move that
is actually allowed. A brand new report shows **On it** and **Won't fix**; **Fixed** only appears
after it has been acknowledged, because a report has to be picked up before it can be finished.

## Promises

| Command | What it does | What you see |
|---|---|---|
| `/promise i-ab12cd 2026-10-15 a fix in the next release` | Promises something to a member by a date | Confirmation with a promise id |
| `/owed` | Open promises, the overdue ones first | A list with who, what and when |
| `/done p-ab12cd` | Marks a promise kept | Confirmation, and the member is told |

You can also name a member instead of an item id. When a promise falls due the bot reminds you,
and tells the member if they agreed to DMs.

## Answers the community reuses

An answer is only ever reused after a manager says so. Nothing on a fresh install is reusable.

| Command | What it does | What you see |
|---|---|---|
| `/answers` | Every answer on record | Each one with the question, the answer, who gave it, whether it is confirmed, and the yes/no votes. Keep and Discard buttons for the ones waiting |
| `/confirm a-ab12cd` | Allows that answer to be reused | Confirmation |
| `/retire a-ab12cd` | Stops it being reused, permanently | Confirmation |

When the member bot captures an answer — because a manager answered a member's question, or a
member's answer got thanked — **it says nothing in the group**. It messages each manager privately
with the question, the proposed answer, and **Keep** and **Discard** buttons. Keep makes it
reusable; Discard retires it. If it cannot reach any manager, the answer simply waits in
`/answers`. It is never announced in the group.

If two confirmed answers both match a question closely, the member is told the team has been asked
to confirm — and is shown neither — while you get both with Keep and Retire buttons.

## Members

| Command | What it does | What you see |
|---|---|---|
| `/member @ada` | What the bot holds about one member | Their facts, what they raised, promises made to them, and any manager notes about them |
| `/note she runs the Lagos meetup` | A manager-only note | Confirmation. Stored on a **separate Walrus account** the member bot cannot read |
| `/notes` | Reads those notes back | The list |
| `/helpers` | Who has contribution points | A ranked list. Points come from answers that got thanked |
| `/ambassador @ada` | Makes somebody an ambassador | Confirmation |
| `/unambassador @ada` | Removes that | Confirmation |

`/member` works with a name, a member code, or nothing at all if you are replying to the person's
message.

## Reports and health

| Command | What it does | What you see |
|---|---|---|
| `/report` | A weekly update drafted from counted data | A draft you can edit and post, with the counts it was written from printed underneath |
| `/status` | Whether the memory, queue, budget and sequence are healthy | Numbers, no secrets |

`/report` never invents a number. Anything the model writes that does not match the counts is
thrown away and you get the counts instead.

---

# Questions people ask

**Why did it not answer me in the group?**
It only answers when you `@` mention it, so it does not fill the chat. In a direct message it
always answers. If you have not tapped **I agree** yet, it replies with those buttons instead.

**Why did it ask me which one I meant?**
Your question was very close to one already answered, but a key word was different — a different
token, network, device or version. Rather than hand you an answer about the wrong thing, it asks.
Say yes to see the old answer, or anything else to get your own question answered.

**Why did it not reuse an answer that obviously exists?**
One of three reasons. No manager has confirmed that answer yet, so it is not reusable. Or your
question was too short for it to be sure what you meant — it needs at least a couple of real words
of its own. Or two answers matched equally well, in which case it refuses to choose and asks the
team.

**How do I see what it knows about me?**
`/mydata`, in a direct message to the member bot. Every line has a date and a receipt you can open
on Walruscan.

**Can I delete my data?**
Not a single memory, no. Walrus is permanent storage, so nothing written there can be removed by
anyone, including the people who built this. `/correct` adds a correction that replaces the old
line for everything the bot does from then on, and the old line stays on Walrus. This is exactly
why it asks you to agree before it keeps anything.

**What is a "receipt"?**
A link to the actual blob on Walrus holding that memory. You can open it and see that the thing the
bot told you is really stored, rather than taking its word for it.

**Who can see my messages?**
Managers can see what you raised and what the bot holds about you, through `/member`. Other
members cannot: the bot refuses to tell anybody anything about another member. Anything you report
in a direct message stays private to you and the managers; anything raised in the group is treated
as public to the community.
