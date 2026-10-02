import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Info, ArrowLeft, Trash2 } from 'lucide-react';
import { formatISODate } from '../utils/dateTime';
import { templates as mockTemplates } from '../data/mockData';
import { Modal, Toast, useToast } from '../components/ui';

const CATEGORIES = [
  'Enquiry',
  'Renewal',
  'Cancellation',
  'Partnership',
  'Finance',
  'Complaint',
  'Welcome',
  'Auto-reply'
];

const INBOXES = [
  'info@powermusic.com',
  'support@powermusic.com'
];

export default function TemplateEditor({ mode = 'new' }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast } = useToast();

  // Load global templates list from localStorage
  const [templates, setTemplates] = useState(() => {
    const stored = localStorage.getItem('power_music_templates');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // fallback
      }
    }
    return mockTemplates;
  });

  // Local form states
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [inbox, setInbox] = useState(INBOXES[0]);
  const [status, setStatus] = useState('Draft');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // If in edit mode, fetch current template values
  useEffect(() => {
    if (mode === 'edit' && id) {
      const template = templates.find((t) => t.id === id);
      if (template) {
        setName(template.name || '');
        setCategory(template.category || CATEGORIES[0]);
        setInbox(template.inbox || INBOXES[0]);
        setStatus(template.status === 'Archived' ? 'Draft' : template.status || 'Draft');
        setSubject(template.subject || '');
        setBody(template.body || '');
      } else {
        // Template not found, redirect to library
        navigate('/templates');
      }
    }
  }, [mode, id, templates, navigate]);

  // Insert variable at cursor position inside body textarea
  const handleInsertVariable = (variable) => {
    const textarea = document.getElementById('template-body-textarea');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = body;
    const newVal = currentVal.substring(0, start) + variable + currentVal.substring(end);
    
    setBody(newVal);

    // Reposition cursor and refocus
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + variable.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Save template handler
  const handleSave = (forcedStatus) => {
    if (!name.trim() || !subject.trim() || !body.trim()) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    const saveStatus = forcedStatus || status;
    const todayStr = formatISODate();

    let updatedTemplates;

    if (mode === 'edit' && id) {
      // Edit mode: update existing template in list
      updatedTemplates = templates.map((t) => {
        if (t.id === id) {
          return {
            ...t,
            name,
            category,
            inbox,
            status: saveStatus,
            subject,
            body,
            lastUpdated: todayStr
          };
        }
        return t;
      });
    } else {
      // New mode: generate ID and append to templates list
      const newId = `tmpl-${Math.random().toString(36).substring(2, 9)}`;
      const newTemplate = {
        id: newId,
        name,
        category,
        inbox,
        status: saveStatus,
        timesUsed: 0,
        lastUpdated: todayStr,
        subject,
        body
      };
      updatedTemplates = [...templates, newTemplate];
    }

    // Persist changes and navigate back
    localStorage.setItem('power_music_templates', JSON.stringify(updatedTemplates));
    showToast('Template saved.', 'success');
    navigate('/templates');
  };

  // Delete template handler
  const handleDelete = () => {
    const updated = templates.filter((t) => t.id !== id);
    localStorage.setItem('power_music_templates', JSON.stringify(updated));
    setShowDeleteModal(false);
    showToast('Template deleted.', 'success');
    navigate('/templates');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 select-none relative">
      {/* Breadcrumb Navigation Header */}
      <div className="flex items-center gap-3 pb-2">
        <Link
          to="/templates"
          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
          {mode === 'edit' ? `Edit Template: ${name}` : 'New Template'}
        </h2>
      </div>

      {/* Main Form Body */}
      <div className="bg-white border border-[var(--color-border-default)] shadow-sm rounded-lg p-8 space-y-6 text-left">
        {/* Row 1: Template Name */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
            Template Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cancellation Acknowledgement v2"
            className="block w-full border border-[var(--color-border-default)] rounded-md px-3.5 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)] placeholder-[var(--color-text-muted)] bg-white transition-colors"
          />
        </div>

        {/* Row 2: Category & Inbox split */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
              Category *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="block w-full border border-[var(--color-border-default)] rounded-md px-3.5 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)] bg-white cursor-pointer transition-colors"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
              Inbox *
            </label>
            <select
              value={inbox}
              onChange={(e) => setInbox(e.target.value)}
              className="block w-full border border-[var(--color-border-default)] rounded-md px-3.5 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)] bg-white cursor-pointer transition-colors"
            >
              {INBOXES.map((box) => (
                <option key={box} value={box}>
                  {box}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Status Radios */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
            Status
          </label>
          <div className="flex items-center gap-6">
            {['Active', 'Draft'].map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 text-sm font-semibold cursor-pointer text-[var(--color-text-primary)]"
              >
                <input
                  type="radio"
                  name="templateStatus"
                  value={option}
                  checked={status === option}
                  onChange={(e) => setStatus(e.target.value)}
                  className="text-[var(--color-brand-accent)] focus:ring-[var(--color-brand-accent)] w-4 h-4 cursor-pointer"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>

        <hr className="border-[var(--color-border-default)] my-6" />

        {/* Row 4: Subject Line */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
            Subject Line *
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Re: Your membership cancellation request"
            className="block w-full border border-[var(--color-border-default)] rounded-md px-3.5 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-focus)] placeholder-[var(--color-text-muted)] bg-white transition-colors"
          />
          <span className="block text-[11px] font-semibold text-[var(--color-text-muted)] pt-0.5">
            Use {"{{subject}}"} to pull the original email subject.
          </span>
        </div>

        {/* Row 5: Body Editor */}
        <div className="space-y-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            <label className="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
              Body *
            </label>
            {/* Variable helpers chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mr-1">
                Insert:
              </span>
              {['{{first_name}}', '{{last_name}}', '{{inbox_name}}'].map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => handleInsertVariable(variable)}
                  className="px-2 py-0.5 border border-[var(--color-border-default)] rounded-full text-xs font-semibold bg-gray-55 hover:bg-gray-100 transition-colors focus:outline-none cursor-pointer"
                >
                  {variable}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="template-body-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{first_name}},\n\nWe have received your request..."
            rows={10}
            className="block w-full border border-[var(--color-border-default)] rounded-md p-3.5 text-sm text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-border-focus)] placeholder-[var(--color-text-muted)] bg-white transition-colors"
          />
        </div>

        {/* Danger Zone (Visible only in edit mode) */}
        {mode === 'edit' && (
          <div className="bg-red-50/20 border border-red-200 rounded-md p-6 mt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-red-800">
                Danger Zone
              </h4>
              <p className="text-xs font-semibold text-red-700 mt-1 leading-normal">
                Delete this template. Once deleted, it cannot be recovered.
              </p>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-4 py-2 border border-red-200 rounded-md text-sm font-bold text-red-600 bg-white hover:bg-red-50 transition-colors focus:outline-none cursor-pointer shrink-0"
            >
              Delete Template
            </button>
          </div>
        )}

        {/* Footer actions row */}
        <div className="flex items-center justify-end gap-3 pt-6 border-t border-[var(--color-border-default)]">
          <button
            onClick={() => handleSave('Draft')}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors cursor-pointer"
          >
            Save as Draft
          </button>
          <button
            onClick={() => handleSave()}
            className="px-4 py-2 border border-transparent rounded-md text-sm font-semibold text-white bg-[var(--color-brand-accent)] hover:bg-[var(--color-brand-accent-hover)] focus:outline-none transition-colors cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        confirm
        title="Delete template"
        footer={
          <>
            <button
              onClick={() => setShowDeleteModal(false)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 border border-transparent rounded-md text-sm font-semibold text-white bg-red-600 hover:bg-red-700 focus:outline-none transition-colors cursor-pointer"
            >
              Delete Template
            </button>
          </>
        }
      >
        <p>
          Are you sure you want to delete this template? This cannot be undone.
        </p>
      </Modal>

      <Toast />
    </div>
  );
}
