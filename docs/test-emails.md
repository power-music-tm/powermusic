# QA test emails — Power Music customer support

Send each from an OUTSIDE account (e.g. rubabzahra463@gmail.com) to the
connected inbox (rubabzahra248@gmail.com). One email per intent, plus two
special cases. Do not reply to any of them before the app imports them.

Expected result per email is noted under each.

---

## 1. Enquiry
**Subject:** Which mix for a 45 minute spin class?

Hi Power Music team,

I'm a cycling instructor and I teach three 45-minute spin classes a week.
Could you recommend one of your pre-mixed albums with BPM around 130-150?
I saw Bootcamp PowerMix but I'm not sure it fits indoor cycling.

Thanks,
Jessica Miller
FitCycle Studio

*Expected: intent = Enquiry, draft created, not flagged.*

---

## 2. Cancellation
**Subject:** Please cancel my Power Music Now subscription

Hello,

I want to cancel my Power Music Now app subscription effective this month.
I'm taking a break from teaching, so I won't need it for a while.
My account email is this one.

Regards,
Mark Stevens

*Expected: intent = Cancellation, draft created.*

---

## 3. Renewal
**Subject:** Renewing our studio music license

Hi,

Our gym's annual music license with Power Music expires at the end of this
month. We'd like to renew for another year for both of our locations.
Could you send over the renewal options and pricing?

Best,
Amanda Cole
Pulse Fitness Studios

*Expected: intent = Renewal, draft created.*

---

## 4. Partnership
**Subject:** Partnership opportunity - boutique studio chain

Dear Power Music,

We operate six boutique fitness studios and are looking for a licensed
music partner for all our group classes. Would you be open to a call to
discuss a partnership or volume licensing deal?

Kind regards,
Daniel Reyes
Momentum Studios Group

*Expected: intent = Partnership, draft created.*

---

## 5. Finance
**Subject:** Charged twice for Top 40 Vol. 96

Hi,

I bought the album "Top 40 Vol. 96" last week and my card statement shows
two charges of $34.95 instead of one. Could you check my order and correct
the billing?

Thank you,
Susan Park

*Expected: intent = Finance. May be flagged (billing/account-specific).*

---

## 6. Events
**Subject:** Will you be at the IDEA World fitness convention?

Hey Power Music,

A few of us instructors are attending the IDEA World convention this
summer. Will Power Music have a booth or run any workshop sessions there?
Would love to meet the team.

Cheers,
Tina Alvarez

*Expected: intent = Events, draft created.*

---

## 7. Refund (flag test)
**Subject:** Refund request - wrong album purchased

Hello,

I accidentally purchased "Active Seniors Vol. 16" instead of the yoga
collection I wanted. I haven't downloaded it. Please refund my purchase
and I'll buy the correct one.

Thanks,
Robert Chen

*Expected: FLAGGED for manual review (refunds need the admin).*

---

## 8. French (language test)
**Subject:** Renouvellement de notre abonnement studio

Bonjour,

Notre abonnement musique pour le studio expire bientot. Nous voulons le
renouveler pour un an. Pouvez-vous nous envoyer les options et les prix?

Merci beaucoup,
Claire Dubois
Studio Vitalite, Paris

*Expected: language = fr, intent = Renewal, draft in French.*
