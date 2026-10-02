// ─────────────────────────────────────────────────────────────
//  PENDING REQUESTS  (displayId: newest = 1)
// ─────────────────────────────────────────────────────────────
export const pendingRequests = [
  {
    id: "req-001",
    displayId: 1,
    receivedAt: "2026-06-23T09:41:00",
    submittedBy: {
      firstName: "Claire", lastName: "Hodges",
      email: "c.hodges@puregym.com", club: "PureGym Leeds"
    },
    person: { firstName: "James", lastName: "Walsh", email: "j.walsh@puregym.com", location: "Manchester" },
    action: "Add",
    notes: "Starting Monday 30 June, full membership.",
    tags: ["Already Exists"],
    createdBy: "Claire Hodges (Manager)"
  },
  {
    id: "req-002",
    displayId: 2,
    receivedAt: "2026-06-23T08:15:00",
    submittedBy: {
      firstName: "Deven", lastName: "Patel",
      email: "d.patel@anytime.com", club: "Anytime Fitness Birmingham"
    },
    person: { firstName: "Mike", lastName: "Hassan", email: "m.hassan@anytime.com", location: "Birmingham" },
    action: "Add",
    notes: "",
    tags: [],
    createdBy: "Deven Patel (Manager)"
  },
  {
    id: "req-003",
    displayId: 3,
    receivedAt: "2026-06-22T16:30:00",
    submittedBy: {
      firstName: "Rachel", lastName: "Clarke",
      email: "r.clarke@puregym.com", club: "PureGym Manchester"
    },
    person: { firstName: "Lisa", lastName: "Park", email: "l.park@puregym.com", location: "Leeds" },
    action: "Remove",
    notes: "Lisa has left the club as of 30 June.",
    tags: [],
    createdBy: "Rachel Clarke (Manager)"
  }
];

// ─────────────────────────────────────────────────────────────
//  HANDLED REQUESTS  (displayId: newest = 1)
// ─────────────────────────────────────────────────────────────
export const handledRequests = [
  {
    id: "req-h-001",
    displayId: 1,
    receivedAt: "2026-06-22T07:45:00",
    handledAt:  "2026-06-22T08:30:00",
    submittedBy: {
      firstName: "Deven", lastName: "Patel",
      email: "d.patel@puregym.com", club: "PureGym Leeds"
    },
    person: { firstName: "Sarah", lastName: "Cole", email: "s.cole@puregym.com", location: "Leeds" },
    action: "Remove",
    notes: "Sarah no longer works at this location.",
    tags: ["Removed"]
  },
  {
    id: "req-h-002",
    displayId: 2,
    receivedAt: "2026-06-21T13:30:00",
    handledAt:  "2026-06-21T14:15:00",
    submittedBy: {
      firstName: "Admin", lastName: "",
      email: "andrea@powermusic.com", club: "Manual entry"
    },
    person: { firstName: "Tom", lastName: "Briggs", email: "t.briggs@fitlife.com", location: "Bristol" },
    action: "Add",
    notes: "Manual admin entry: no manager form on file.",
    tags: ["Added"]
  },
  {
    id: "req-h-003",
    displayId: 3,
    receivedAt: "2026-06-18T10:15:00",
    handledAt:  "2026-06-18T11:02:00",
    submittedBy: {
      firstName: "Rachel", lastName: "Clarke",
      email: "r.clarke@puregym.com", club: "PureGym Manchester"
    },
    person: { firstName: "Priya", lastName: "Sharma", email: "p.sharma@puregym.com", location: "Manchester" },
    action: "Add",
    notes: "",
    tags: ["Added", "Already Exists"]
  },
  {
    id: "req-h-004",
    displayId: 4,
    receivedAt: "2026-06-16T08:30:00",
    handledAt:  "2026-06-16T09:15:00",
    submittedBy: {
      firstName: "Claire", lastName: "Hodges",
      email: "c.hodges@puregym.com", club: "PureGym Leeds"
    },
    person: { firstName: "Kevin", lastName: "Osei", email: "k.osei@anytime.com", location: "Birmingham" },
    action: "Add",
    notes: "Approved by regional manager.",
    tags: ["Added"]
  },
  {
    id: "req-h-005",
    displayId: 5,
    receivedAt: "2026-06-13T16:20:00",
    handledAt:  "2026-06-13T17:00:00",
    submittedBy: {
      firstName: "Deven", lastName: "Patel",
      email: "d.patel@anytime.com", club: "Anytime Birmingham"
    },
    person: { firstName: "Nina", lastName: "Bell", email: "n.bell@fitlife.com", location: "Bristol" },
    action: "Add",
    notes: "Awaiting template assignment for Bristol rollout.",
    tags: ["Added"]
  }
];

// ─────────────────────────────────────────────────────────────
//  Directory  (displayId: newest = 1)
// ─────────────────────────────────────────────────────────────
export const directoryData = [
  {
    id: "ul-001", displayId: 1,
    firstName: "James", lastName: "Walsh",
    email: "j.walsh@puregym.com", location: "Manchester",
    status: "Added", dateAdded: "2026-06-22T08:30:00",
    addedBy: "Claire Hodges", managerEmail: "c.hodges@puregym.com", club: "PureGym Leeds",
    sourceRequestId: "req-h-legacy-01",
    notes: "Transferred from legacy system. Verified club access on 22 Jun."
  },
  {
    id: "ul-002", displayId: 2,
    firstName: "Mike", lastName: "Hassan",
    email: "m.hassan@anytime.com", location: "Birmingham",
    status: "Added", dateAdded: "2026-06-21T14:15:00",
    addedBy: "Deven Patel", managerEmail: "d.patel@anytime.com", club: "Anytime Birmingham",
    sourceRequestId: "req-002",
    notes: ""
  },
  {
    id: "ul-003", displayId: 3,
    firstName: "Tom", lastName: "Briggs",
    email: "t.briggs@fitlife.com", location: "Bristol",
    status: "Added", dateAdded: "2026-06-21T14:15:00",
    addedBy: "Power Music Admin", managerEmail: "andrea@powermusic.com", club: "Manual entry",
    sourceRequestId: "req-h-002",
    notes: "Manual admin entry: no manager form on file."
  },
  {
    id: "ul-004", displayId: 4,
    firstName: "Priya", lastName: "Sharma",
    email: "p.sharma@puregym.com", location: "Manchester",
    status: "Added", dateAdded: "2026-06-18T11:02:00",
    addedBy: "Rachel Clarke", managerEmail: "r.clarke@puregym.com", club: "PureGym Manchester",
    sourceRequestId: "req-h-003",
    notes: ""
  },
  {
    id: "ul-005", displayId: 5,
    firstName: "Lisa", lastName: "Park",
    email: "l.park@puregym.com", location: "Leeds",
    status: "Removed", dateAdded: "2026-06-22T09:00:00",
    addedBy: "Rachel Clarke", managerEmail: "r.clarke@puregym.com", club: "PureGym Manchester",
    sourceRequestId: "req-h-legacy-02",
    notes: "Left club: access revoked per manager request."
  },
  {
    id: "ul-006", displayId: 6,
    firstName: "Sarah", lastName: "Cole",
    email: "s.cole@puregym.com", location: "Leeds",
    status: "Removed", dateAdded: "2026-06-22T08:30:00",
    addedBy: "Deven Patel", managerEmail: "d.patel@puregym.com", club: "PureGym Leeds",
    sourceRequestId: "req-h-legacy-03",
    notes: "Duplicate entry removed. Primary record kept under R-04."
  },
  {
    id: "ul-007", displayId: 7,
    firstName: "Kevin", lastName: "Osei",
    email: "k.osei@anytime.com", location: "Birmingham",
    status: "Added", dateAdded: "2026-06-16T09:15:00",
    addedBy: "Claire Hodges", managerEmail: "c.hodges@puregym.com", club: "PureGym Leeds",
    sourceRequestId: "req-h-004",
    notes: ""
  },
  {
    id: "ul-008", displayId: 8,
    firstName: "Nina", lastName: "Bell",
    email: "n.bell@fitlife.com", location: "Bristol",
    status: "Added", dateAdded: "2026-06-13T17:00:00",
    addedBy: "Deven Patel", managerEmail: "d.patel@anytime.com", club: "Anytime Birmingham",
    sourceRequestId: "req-h-005",
    notes: "Awaiting template assignment for new Bristol rollout."
  },
  {
    id: "ul-009", displayId: 9,
    firstName: "Amara", lastName: "Okonkwo",
    email: "a.okonkwo@fitlife.com", location: "London",
    status: "Added", dateAdded: "2026-05-28T10:45:00",
    addedBy: "Claire Hodges", managerEmail: "c.hodges@puregym.com", club: "PureGym Leeds",
    sourceRequestId: "req-h-legacy-04",
    notes: ""
  },
  {
    id: "ul-010", displayId: 10,
    firstName: "Daniel", lastName: "Ferreira",
    email: "d.ferreira@anytime.com", location: "Bristol",
    status: "Added", dateAdded: "2026-05-20T14:30:00",
    addedBy: "Deven Patel", managerEmail: "d.patel@anytime.com", club: "Anytime Birmingham",
    sourceRequestId: "req-h-legacy-05",
    notes: "Regional manager approved. Onboarding email sent 20 May."
  }
  // Note: In demo, display "47 records total" — the 10 above are the visible sample
];

// ─────────────────────────────────────────────────────────────
//  CONNECTED INBOXES
// ─────────────────────────────────────────────────────────────
export const connectedInboxes = [
  { email: 'cc@powermusic.com', title: 'Customer Care' },
  { email: 'cc@powermusicapp.com', title: 'Music Apps' },
  { email: 'info@powermusic.com', title: 'General Info' },
  { email: 'tracks@powermusic.com', title: 'Tracks' },
  { email: 'royaltyfree@powermusic.com', title: 'Royalty Free Music' }
];

// ─────────────────────────────────────────────────────────────
//  EMAIL QUEUE
// ─────────────────────────────────────────────────────────────
export const emailQueue = [
  {
    id: 'email-001',
    from: 'Sarah Mitchell',
    fromEmail: 'sarah.mitchell@example.com',
    subject: 'Membership enquiry for Birmingham club',
    inbox: 'cc@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 94,
    templateUsed: 'Membership Enquiry',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-24T09:15:00',
    flagged: false,
    urgent: false,
    read: false,
    body: 'Hi there,\n\nI am interested in joining your Birmingham club and wanted to ask about membership options and pricing for corporate accounts.\n\nCould someone get back to me this week?\n\nThanks,\nSarah'
  },
  {
    id: 'email-002',
    from: 'James Walsh',
    fromEmail: 'j.walsh@puregym.com',
    subject: 'Cancellation request - member #4421',
    inbox: 'cc@powermusic.com',
    intent: 'Cancellation',
    intentConfidence: 91,
    templateUsed: 'Cancellation Acknowledgement',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-24T08:42:00',
    flagged: false,
    urgent: true,
    read: false,
    body: 'Hello,\n\nPlease cancel membership #4421 for one of our Manchester members effective immediately.\n\nRegards,\nJames Walsh\nPureGym Manchester'
  },
  {
    id: 'email-003',
    from: 'Unknown Sender',
    fromEmail: 'angry.customer@mail.com',
    subject: 'THIS IS UNACCEPTABLE',
    inbox: 'info@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 42,
    templateUsed: null,
    draftStatus: 'Flagged',
    receivedAt: '2025-06-24T08:30:00',
    flagged: true,
    flagReason: 'Aggressive tone detected',
    urgent: true,
    read: true,
    body: 'I have been trying to reach someone for THREE WEEKS. Nobody has replied to my emails. This is completely unacceptable and I expect a response TODAY.'
  },
  {
    id: 'email-004',
    from: 'Tom Briggs',
    fromEmail: 'tom.briggs@anytimefitness.com',
    subject: 'Renewal options for corporate account',
    inbox: 'tracks@powermusic.com',
    intent: 'Renewal',
    intentConfidence: 88,
    templateUsed: 'Renewal Reminder',
    draftStatus: 'Reviewed',
    receivedAt: '2025-06-23T16:20:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Hi Power Music team,\n\nOur corporate account is up for renewal next month. Can you send through the updated licensing options for our 12 Anytime Fitness locations?\n\nBest,\nTom'
  },
  {
    id: 'email-005',
    from: 'Helen Price',
    fromEmail: 'helen.price@studio.co.uk',
    subject: 'Partnership opportunity for music licensing',
    inbox: 'royaltyfree@powermusic.com',
    intent: 'Partnership',
    intentConfidence: 86,
    templateUsed: 'General Enquiry Response',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-23T11:05:00',
    flagged: false,
    urgent: false,
    read: false,
    body: 'Dear Power Music,\n\nWe run a chain of boutique fitness studios and are looking for a music licensing partner. Would you be open to a call next week to discuss terms?\n\nHelen Price\nStudio Collective'
  },
  {
    id: 'email-006',
    from: 'Finance Team',
    fromEmail: 'accounts@leedsgym.co.uk',
    subject: 'Invoice query for March billing',
    inbox: 'cc@powermusicapp.com',
    intent: 'Finance',
    intentConfidence: 90,
    templateUsed: 'Invoice Query Response (Draft)',
    draftStatus: 'Sent',
    receivedAt: '2025-06-22T14:30:00',
    sentAt: '2025-06-22T15:10:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Hello,\n\nWe received invoice #PM-2025-0342 but the amount does not match our records for March. Please clarify the line items for the Leeds location.\n\nAccounts Team'
  },
  {
    id: 'email-007',
    from: 'Priya Sharma',
    fromEmail: 'p.sharma@puregym.com',
    subject: 'Class playlist request for spin studio',
    inbox: 'tracks@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 92,
    templateUsed: 'General Enquiry Response',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-24T07:55:00',
    flagged: false,
    urgent: false,
    read: false,
    body: 'Could you recommend a high-energy playlist package for our spin studio launch in Manchester? We need around 40 tracks licensed for commercial use.\n\nThanks,\nPriya Sharma'
  },
  {
    id: 'email-008',
    from: 'David Chen',
    fromEmail: 'd.chen@wellnesshub.io',
    subject: 'Payment failed notification follow-up',
    inbox: 'cc@powermusic.com',
    intent: 'Finance',
    intentConfidence: 87,
    templateUsed: 'Payment Failed Notice',
    draftStatus: 'Flagged',
    receivedAt: '2025-06-23T18:40:00',
    flagged: true,
    flagReason: 'Payment retry needs manual approval',
    urgent: true,
    read: true,
    body: 'Our payment for the annual subscription failed yesterday. We have updated our card details and need you to retry the charge as soon as possible.\n\nDavid Chen\nWellness Hub'
  },
  {
    id: 'email-009',
    from: 'Lisa Park',
    fromEmail: 'l.park@puregym.com',
    subject: 'Summer event music licensing',
    inbox: 'royaltyfree@powermusic.com',
    intent: 'Events',
    intentConfidence: 89,
    templateUsed: 'Event Invitation',
    draftStatus: 'Reviewed',
    receivedAt: '2025-06-23T09:12:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Hello Power Music,\n\nWe are hosting an outdoor summer fitness event in Leeds on 12 July. What licensing do we need for live DJ sets and pre-recorded warm-up tracks?\n\nLisa Park'
  },
  {
    id: 'email-010',
    from: 'Kevin Osei',
    fromEmail: 'k.osei@anytime.com',
    subject: 'Urgent: music cut out during peak hours',
    inbox: 'cc@powermusicapp.com',
    intent: 'Enquiry',
    intentConfidence: 78,
    templateUsed: null,
    draftStatus: 'Flagged',
    receivedAt: '2025-06-24T06:20:00',
    flagged: true,
    flagReason: 'Technical issue - no template matched',
    urgent: true,
    read: false,
    body: 'Our app music stopped working during peak hours this morning across two Birmingham sites. Members are complaining. Need urgent help.'
  },
  {
    id: 'email-011',
    from: 'Nina Bell',
    fromEmail: 'n.bell@fitlife.com',
    subject: 'Welcome pack and onboarding timeline',
    inbox: 'info@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 95,
    templateUsed: 'Welcome Email',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-22T10:00:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'We signed up last week and have not received the welcome pack yet. When should we expect onboarding to be complete?\n\nNina Bell\nFitLife Bristol'
  },
  {
    id: 'email-012',
    from: 'Mark Sullivan',
    fromEmail: 'm.sullivan@gymgroup.co.uk',
    subject: 'Contract renewal - multi-site discount',
    inbox: 'cc@powermusic.com',
    intent: 'Renewal',
    intentConfidence: 93,
    templateUsed: 'Renewal Reminder',
    draftStatus: 'Sent',
    receivedAt: '2025-06-21T11:30:00',
    sentAt: '2025-06-21T14:00:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Dear team,\n\nOur 8-site contract expires in August. Please send renewal terms including any multi-site discount for 2025-26.\n\nMark Sullivan'
  },
  {
    id: 'email-013',
    from: 'Emma Torres',
    fromEmail: 'emma.torres@yogaflow.uk',
    subject: 'Cancellation - end of month',
    inbox: 'info@powermusic.com',
    intent: 'Cancellation',
    intentConfidence: 96,
    templateUsed: 'Cancellation Acknowledgement',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-24T10:05:00',
    flagged: false,
    urgent: false,
    read: false,
    body: 'Please confirm cancellation of our subscription effective 30 June. We are closing our Bristol studio and need written confirmation.\n\nEmma Torres'
  },
  {
    id: 'email-014',
    from: 'Regional Ops',
    fromEmail: 'ops@puregym.com',
    subject: 'Partnership review Q3',
    inbox: 'cc@powermusicapp.com',
    intent: 'Partnership',
    intentConfidence: 84,
    templateUsed: 'General Enquiry Response',
    draftStatus: 'Reviewed',
    receivedAt: '2025-06-22T16:45:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Hi Power Music,\n\nWe would like to schedule a Q3 partnership review covering app integration and member engagement metrics.\n\nRegional Ops Team'
  },
  {
    id: 'email-015',
    from: 'Accounts Payable',
    fromEmail: 'ap@studio.co.uk',
    subject: 'Re: Payment received confirmation',
    inbox: 'tracks@powermusic.com',
    intent: 'Finance',
    intentConfidence: 91,
    templateUsed: 'Payment Confirmation',
    draftStatus: 'Sent',
    receivedAt: '2025-06-20T09:00:00',
    sentAt: '2025-06-20T11:30:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Thank you for confirming payment. Please find attached remittance advice for your records.\n\nAccounts Payable\nStudio Collective'
  },
  {
    id: 'email-016',
    from: 'Sophie Grant',
    fromEmail: 's.grant@crossfitbox.co.uk',
    subject: 'General question about licensing tiers',
    inbox: 'royaltyfree@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 90,
    templateUsed: 'Membership Enquiry',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-23T14:22:00',
    flagged: false,
    urgent: false,
    read: false,
    body: 'Hello,\n\nWe are a small CrossFit box evaluating music licensing tiers. What is the difference between your Standard and Premium packages?\n\nSophie'
  },
  {
    id: 'email-017',
    from: 'IT Support',
    fromEmail: 'it@anytime.com',
    subject: 'API integration credentials request',
    inbox: 'cc@powermusicapp.com',
    intent: 'Partnership',
    intentConfidence: 82,
    templateUsed: 'General Enquiry Response',
    draftStatus: 'Draft Created',
    receivedAt: '2025-06-23T08:00:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Our IT team needs API credentials for the music app integration on test environments. Who should we contact for sandbox access?\n\nIT Support\nAnytime Fitness'
  },
  {
    id: 'email-018',
    from: 'James Walsh',
    fromEmail: 'j.walsh@puregym.com',
    subject: 'Re: Membership enquiry follow-up',
    inbox: 'cc@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 88,
    templateUsed: 'Membership Enquiry',
    draftStatus: 'Sent',
    receivedAt: '2025-06-19T15:00:00',
    sentAt: '2025-06-19T16:45:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Thanks for the info. We will proceed with the corporate membership for Manchester. Please send the contract.'
  },
  {
    id: 'email-019',
    from: 'Rachel Cohen',
    fromEmail: 'r.cohen@fitnessfirst.com',
    subject: 'Escalation: sound levels complaint at Reading',
    inbox: 'cc@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 71,
    templateUsed: null,
    draftStatus: 'Flagged',
    receivedAt: '2025-06-22T13:15:00',
    flagged: true,
    flagReason: 'Complaint needs manager review',
    urgent: true,
    read: false,
    body: 'Members at our Reading site have complained about music volume during evening classes. We need guidance on adjusting levels without breaching your licensing terms.\n\nRachel Cohen\nFitness First'
  },
  {
    id: 'email-020',
    from: 'Paul Nguyen',
    fromEmail: 'p.nguyen@gymgroup.co.uk',
    subject: 'Re: January licence invoice',
    inbox: 'cc@powermusic.com',
    intent: 'Finance',
    intentConfidence: 84,
    templateUsed: 'Payment Confirmation',
    draftStatus: 'Sent',
    receivedAt: '2025-06-15T10:30:00',
    sentAt: '2025-06-15T11:00:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Thanks for confirming receipt of our January payment. Please update our billing contact to accounts@gymgroup.co.uk going forward.\n\nPaul Nguyen'
  },
  {
    id: 'email-021',
    from: 'Sarah Mitchell',
    fromEmail: 'sarah.mitchell@example.com',
    subject: 'Re: Membership enquiry for Birmingham club',
    inbox: 'cc@powermusic.com',
    intent: 'Enquiry',
    intentConfidence: 94,
    templateUsed: 'Membership Enquiry',
    draftStatus: 'Sent',
    receivedAt: '2025-06-24T11:20:00',
    sentAt: '2025-06-24T11:45:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Hi Sarah,\n\nThanks for your enquiry about corporate membership at Birmingham. I have attached our pricing options and a summary of benefits for corporate accounts.\n\nKind regards,\nPower Music Team'
  },
  {
    id: 'email-022',
    from: 'James Walsh',
    fromEmail: 'j.walsh@puregym.com',
    subject: 'Re: Cancellation request - member #4421',
    inbox: 'cc@powermusic.com',
    intent: 'Cancellation',
    intentConfidence: 91,
    templateUsed: 'Cancellation Acknowledgement',
    draftStatus: 'Sent',
    receivedAt: '2025-06-24T09:30:00',
    sentAt: '2025-06-24T10:05:00',
    flagged: false,
    urgent: false,
    read: true,
    body: 'Hi James,\n\nWe have received your cancellation request for member #4421 and will process it within 5 business days. A confirmation will be sent once complete.\n\nKind regards,\nPower Music Team'
  }
];

/** Pre-seeded archived emails for the Email Responses archive tab demo */
export const initialArchivedEmailIds = ['email-012', 'email-018', 'email-020'];

// ─────────────────────────────────────────────────────────────
//  KPI DATA
// ─────────────────────────────────────────────────────────────
export const kpiData = {
  pendingRequests: 3,
  newEmails: 5,
  flaggedEmails: 4,
  templatesActive: 12,
  usersInDirectory: 47,
  alreadyExistsWarnings: 2
};

// ─────────────────────────────────────────────────────────────
//  RECENT ACTIVITY
// ─────────────────────────────────────────────────────────────
export const recentActivity = [
  { id: "act-001", timestamp: "2026-06-23T09:41:00", type: "request_submitted", description: "New request: James Walsh", link: "req-001" },
  { id: "act-002", timestamp: "2026-06-23T09:41:00", type: "tag_applied", description: "⚠ Already Exists tag applied", link: "req-001" },
  { id: "act-003", timestamp: "2026-06-22T08:30:00", type: "marked_removed", description: "Removed: Sarah Cole", link: "req-h-001" },
  { id: "act-004", timestamp: "2026-06-21T14:15:00", type: "marked_added", description: "Added: Tom Briggs", link: "req-h-002" },
  { id: "act-005", timestamp: "2026-06-21T11:00:00", type: "template_updated", description: "Template updated: Membership Enquiry v2", link: null }
];

// ─────────────────────────────────────────────────────────────
//  TEMPLATES
// ─────────────────────────────────────────────────────────────
export const templates = [
  {
    id: "tmpl-001", name: "Membership Enquiry", category: "Membership",
    status: "Active", timesUsed: 34, lastUpdated: "2026-06-10T11:42:00",
    subject: "Re: Your membership enquiry",
    body: "Hi {{first_name}},\n\nI'd be happy to help with your enquiry about joining {{club_name}}.\n\nWe'd be delighted to help with your membership enquiry. Our current membership options are available on our website, and I'd be happy to walk you through the options that best suit your needs.\n\nPlease let me know if you have any questions.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-002", name: "Membership Enquiry (Legacy)", category: "Membership",
    status: "Archived", timesUsed: 12, lastUpdated: "2026-03-01T09:00:00",
    subject: "Re: Enquiry",
    body: "Hi {{first_name}}, thanks for your enquiry about {{membership_type}}."
  },
  {
    id: "tmpl-003", name: "Cancellation Acknowledgement", category: "Membership",
    status: "Active", timesUsed: 18, lastUpdated: "2026-05-15T14:20:00",
    subject: "Re: Your cancellation request",
    body: "Hi {{first_name}},\n\nWe've received your cancellation request for your {{membership_type}} membership at {{club_name}} and will process it within 5 business days.\n\nIf you change your mind, please don't hesitate to get in touch.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-004", name: "Renewal Reminder", category: "Membership",
    status: "Active", timesUsed: 27, lastUpdated: "2026-06-01T10:15:00",
    subject: "Re: Your renewal",
    body: "Hi {{first_name}},\n\nYour {{membership_type}} membership at {{club_name}} is due for renewal.\n\nWe'd love to keep you with us. Please find your renewal options below.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-005", name: "Payment Confirmation", category: "Payments",
    status: "Active", timesUsed: 9, lastUpdated: "2026-04-20T16:30:00",
    subject: "Payment received: {{club_name}}",
    body: "Hi {{first_name}},\n\nWe're confirming receipt of your payment for {{membership_type}} at {{club_name}}.\n\nYour account is now up to date.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-006", name: "Payment Failed Notice", category: "Payments",
    status: "Active", timesUsed: 11, lastUpdated: "2026-05-28T09:45:00",
    subject: "Action required: Payment failed",
    body: "Hi {{first_name}},\n\nUnfortunately your recent payment for your {{membership_type}} membership at {{club_name}} was unsuccessful.\n\nPlease update your payment details at your earliest convenience to avoid any interruption to your membership.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-007", name: "Event Invitation", category: "Events",
    status: "Active", timesUsed: 22, lastUpdated: "2026-06-05T13:00:00",
    subject: "You're invited: {{club_name}} event",
    body: "Hi {{first_name}},\n\nWe'd like to invite you to an upcoming event at {{club_name}}.\n\nDetails will be shared shortly. We hope to see you there!\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-008", name: "General Enquiry Response", category: "General Enquiries",
    status: "Active", timesUsed: 6, lastUpdated: "2026-05-10T11:15:00",
    subject: "Re: Your enquiry",
    body: "Hi {{first_name}},\n\nWe've received your message and will get back to you within 2 business days.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-009", name: "Welcome Email", category: "Membership",
    status: "Active", timesUsed: 41, lastUpdated: "2026-04-01T08:30:00",
    subject: "Welcome to Power Music: {{club_name}}",
    body: "Hi {{first_name}},\n\nWelcome to {{club_name}}! We're thrilled to have you on board as a {{membership_type}} member.\n\nIf you have any questions during your first few weeks, don't hesitate to reach out.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-010", name: "Out of Office Auto-Reply", category: "Other",
    status: "Active", timesUsed: 0, lastUpdated: "2026-06-15T09:00:00",
    subject: "Out of Office: {{club_name}}",
    body: "Hi {{first_name}},\n\nWe are currently out of office and will respond upon our return.\n\nFor urgent matters, please call our main line.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-011", name: "Invoice Query Response (Draft)", category: "Payments",
    status: "Draft", timesUsed: 0, lastUpdated: "2026-06-22T15:30:00",
    subject: "Re: Invoice query",
    body: "Hi {{first_name}},\n\nRegarding your invoice query for your {{membership_type}} account at {{club_name}}.\n\nPlease find the requested information below.\n\nKind regards,\nPower Music Team"
  },
  {
    id: "tmpl-012", name: "Event Follow-Up", category: "Events",
    status: "Active", timesUsed: 3, lastUpdated: "2026-06-20T10:00:00",
    subject: "Thank you for attending: {{club_name}}",
    body: "Hi {{first_name}},\n\nWe hope you enjoyed the recent {{club_name}} event.\n\nWe'd love to hear your feedback.\n\nKind regards,\nPower Music Team"
  }
];
