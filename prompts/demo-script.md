# AskAnything — Demo Script

**Audience:** Solutions Engineering, CSMs, Sales Engineers
**Duration:** 15 minutes + 5 minutes Q&A
**URL:** https://ask-anything-steel.vercel.app

---

## 0. Before you start (do this 10 minutes early)

Getting these wrong is the only way this demo fails:

- [ ] **Connect to the corporate VPN.** The Knowledge Assistant is only reachable
      through the corporate network.
- [ ] **Install and reload the AskAnything browser extension** (Chrome or Edge).
      The hosted app cannot reach the Knowledge Assistant directly, so the extension
      proxies every request through your machine.
- [ ] Open the app and log in.
- [ ] Have a small RFP spreadsheet ready — 8 to 10 questions is plenty.
- [ ] Download `prompts/loopio-rfp.md` and `prompts/simple-three-paragraphs.md` if you
      plan to show Custom mode.

> If you see "Corporate bridge not connected", the extension is not loaded or the VPN is
> down. Fix that before continuing.

---

## 1. The problem (1 min)

> "We all answer the same RFP questions over and over. We copy from old questionnaires,
> we ping each other on Slack, and every answer sounds slightly different depending on
> who wrote it.
>
> AskAnything sits on top of the Dynamic Yield Knowledge Assistant and turns a
> spreadsheet of RFP questions into a spreadsheet of client-ready answers — in our voice,
> with the risky ones flagged for review."

---

## 2. Single question first (3 min)

Go to the **main chat**.

Ask something real, for example:

> *How does Dynamic Yield prevent content flicker while personalization is applied?*

While it answers, make these points:

- It is the **same Knowledge Assistant** we already use internally — same knowledge,
  same sources.
- What is different is the **layer on top**: the answer comes back written for a
  customer, not for us.
- Notice what is *not* there: no "based on my search", no "contact your account team",
  no "this is not documented in the public docs".

> "That cleanup is not cosmetic. Those phrases are exactly what makes an answer unusable
> in an RFP, and they used to be the first thing we had to delete by hand."

---

## 3. The real feature: bulk mode (6 min)

Go to **Batch**.

### 3.1 Load the file

- Drag in the spreadsheet, or paste a OneDrive share link.
- Pick the sheet and the header row.
- Map the **Question** column, and choose where answers and review notes should land.

> "It writes into your own file. You get the same workbook back, with columns filled in —
> not a new format you have to reconcile."

Point out: rows that **already have an answer are skipped**, and section headings like
`Performance, Privacy & Security` are detected and skipped automatically — they are not
questions.

### 3.2 Pick an answer style

Show the four options and say what each is for:

| Style | Use it for |
|---|---|
| **Detailed** | Long-form prose answers |
| **Loopio (RFP)** | Loopio-style: opening paragraph, themed sections, bullets, example |
| **Simple** | Short answers for tight spreadsheet cells |
| **Custom** | Your own `.md` prompt, replacing all built-in rules |

### 3.3 Run it

Press **Start** and let a few rows complete while you talk.

> "One question at a time, on purpose. The Knowledge Assistant takes roughly twenty
> seconds to a minute on a real RFP question, and hammering it in parallel just gets us
> rate-limited. If a row fails, it retries that row with a cooldown instead of dropping
> it."

### 3.4 Needs Review — the important column

Find a row with something in **Needs Review**.

> "This is the part I would pay attention to.
>
> The answer column is always the best client-ready answer we can produce. Anything the
> model was unsure about — an exact latency number, a contractual term, something that
> needs Legal — does not get to pollute the answer. It goes here instead.
>
> So you are not reading 200 answers looking for problems. You are reading the ten that
> are flagged."

Show that you can **edit the review note** and press **Approve**.

---

## 4. Redo with your own source (2 min)

Pick a row whose answer is thin.

- Click **↻ Redo with a link or notes**.
- Paste a KB link, a quote, or a couple of lines of your own notes.
- Press **Ask again**.

> "The material you paste is treated as authoritative. This is how you get your own
> knowledge into an answer without editing the cell by hand."

If the batch is still running, point out the button now says **Queued**:

> "It does not fight with the batch. Queued redos are served between rows, one request at
> a time, and the row shows when it was recalculated."

---

## 5. Custom mode (2 min, optional)

Switch the style to **Custom** and upload `simple-three-paragraphs.md`.

> "If your team has its own house style, you can replace our rules entirely with a
> Markdown file.
>
> One warning: Custom replaces *everything*, including the review signal. If your file
> does not include the CONFIDENCE_REVIEW block, the Needs Review column stops working.
> Both of the templates I am sharing already include it."

---

## 6. Export and wrap up (1 min)

Press **Download** and open the file.

> "Same workbook, your columns, answers and review notes filled in. Nothing to
> reformat."

Close with:

> "What this does not do is replace your judgement. It removes the blank page and the
> copy-paste, and it tells you which answers deserve your attention. The review column is
> the point, not the answer column."

---

## Q&A — likely questions

**"Does our data leave the company?"**
No. The extension proxies every request from your own machine to the internal Knowledge
Assistant over the corporate network. The hosted app cannot reach it on its own.

**"Can it invent things?"**
It is instructed never to invent figures, certifications, or contractual terms, and never
to turn a missing source into a negative claim. Anything unsupported is pushed into Needs
Review. Treat flagged rows as mandatory reading.

**"Why is it slow?"**
The Knowledge Assistant itself takes roughly twenty seconds to a minute per real RFP
question. We run one at a time deliberately to avoid rate limits.

**"Why did a row fail?"**
Almost always the VPN dropped or the extension needs reloading. The error banner now
shows the underlying error, and failed rows can be retried by pressing Start again.

**"Can I answer only part of the file?"**
Yes — set the start row. Rows that already have an answer are skipped automatically.

**"Does it link to Guru?"**
It can *use* Guru knowledge, but Guru, Confluence, and Jira links are stripped from the
output. Only Knowledge Base and developer documentation links are cited.
