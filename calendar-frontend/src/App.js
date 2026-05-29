import React, { useState, useEffect } from 'react';
import {
  Calendar,
  momentLocalizer,
  Views,
} from 'react-big-calendar';

import moment from 'moment';

import {
  Sun,
  Moon,
  Trash2,
  Image,
  X,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
} from 'lucide-react';

import axios from 'axios';

import 'react-big-calendar/lib/css/react-big-calendar.css';
import './App.css';

const localizer = momentLocalizer(moment);

const API_BASE =
  process.env.REACT_APP_API_URL ||
  'http://localhost:5213/api/notes';

const EVENT_COLORS = [
  {
    bg: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    shadow: 'rgba(99,102,241,0.4)',
  },
  {
    bg: 'linear-gradient(135deg,#f43f5e,#fb7185)',
    shadow: 'rgba(244,63,94,0.4)',
  },
  {
    bg: 'linear-gradient(135deg,#0ea5e9,#38bdf8)',
    shadow: 'rgba(14,165,233,0.4)',
  },
  {
    bg: 'linear-gradient(135deg,#10b981,#34d399)',
    shadow: 'rgba(16,185,129,0.4)',
  },
  {
    bg: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
    shadow: 'rgba(245,158,11,0.4)',
  },
  {
    bg: 'linear-gradient(135deg,#ec4899,#f472b6)',
    shadow: 'rgba(236,72,153,0.4)',
  },
];

function getEventColor(id) {
  if (!id) return EVENT_COLORS[0];

  const idx =
    id
      .split('')
      .reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    EVENT_COLORS.length;

  return EVENT_COLORS[idx];
}

function CustomToolbar(toolbar) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-6">
      <div className="flex items-center justify-between w-full lg:w-auto gap-3">
        <button
          onClick={() => toolbar.onNavigate('TODAY')}
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition shadow-lg"
        >
          Today
        </button>

        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
          <button
            onClick={() => toolbar.onNavigate('PREV')}
            className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-700 transition"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={() => toolbar.onNavigate('NEXT')}
            className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-700 transition"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <h2 className="text-lg sm:text-2xl font-bold text-center w-full lg:w-auto">
        {toolbar.label}
      </h2>

      <div className="grid grid-cols-3 w-full sm:w-auto gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
        {['month', 'week', 'day'].map((view) => (
          <button
            key={view}
            onClick={() => toolbar.onView(view)}
            className={`px-4 py-2 rounded-xl capitalize transition ${toolbar.view === view
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'hover:bg-white dark:hover:bg-slate-700'
              }`}
          >
            {view}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState(Views.MONTH);
  const [darkMode, setDarkMode] = useState(false);

  const [notes, setNotes] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);

  const [selectedSlot, setSelectedSlot] = useState(null);

  const [selectedEvent, setSelectedEvent] = useState(null);

  const [noteText, setNoteText] = useState('');

  const [selectedFile, setSelectedFile] = useState(null);

  const [startTime, setStartTime] = useState('09:00');

  const [endTime, setEndTime] = useState('10:00');

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      const res = await axios.get(API_BASE);

      const formattedEvents = res.data.map((note) => {
        const baseDate = note.noteDate.slice(0, 10);

        const start = note.startTime
          ? new Date(`${baseDate}T${note.startTime}`)
          : new Date(`${baseDate}T09:00:00`);

        const end = note.endTime
          ? new Date(`${baseDate}T${note.endTime}`)
          : new Date(start.getTime() + 60 * 60 * 1000);

        return {
          id: note.id,
          title: note.content,
          start,
          end,
          imageUrl: note.imageUrl,
          startTime: note.startTime,
          endTime: note.endTime,
        };
      });

      setNotes(formattedEvents);
    } catch (err) {
      console.error('Error loading notes', err);
    }
  };

  const handleSelectSlot = ({ start, end }) => {
    setSelectedSlot(start);

    setSelectedEvent(null);

    setNoteText('');

    setSelectedFile(null);

    const isSameTime =
      start.getTime() === end.getTime();

    setStartTime(moment(start).format('HH:mm'));

    setEndTime(
      isSameTime
        ? moment(start)
          .add(1, 'hour')
          .format('HH:mm')
        : moment(end).format('HH:mm')
    );

    setIsModalOpen(true);
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event);

    setSelectedSlot(event.start);

    setNoteText(event.title);

    setSelectedFile(null);

    setStartTime(
      event.startTime
        ? event.startTime.slice(0, 5)
        : moment(event.start).format('HH:mm')
    );

    setEndTime(
      event.endTime
        ? event.endTime.slice(0, 5)
        : moment(event.end).format('HH:mm')
    );

    setIsModalOpen(true);
  };

  const handleSaveOrUpdate = async () => {
    const formData = new FormData();

    const formattedDate =
      moment(selectedSlot).format('YYYY-MM-DD');

    formData.append('content', noteText);

    formData.append('noteDate', formattedDate);

    formData.append('startTime', startTime);

    formData.append('endTime', endTime);

    if (selectedFile) {
      formData.append('image', selectedFile);
    }

    try {
      if (selectedEvent) {
        await axios.put(
          `${API_BASE}/${selectedEvent.id}`,
          formData
        );
      } else {
        await axios.post(API_BASE, formData);
      }

      fetchNotes();

      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving note', err);
    }
  };

  const handleDelete = async () => {
    if (
      window.confirm(
        'Delete this note permanently?'
      )
    ) {
      try {
        await axios.delete(
          `${API_BASE}/${selectedEvent.id}`
        );

        fetchNotes();

        setIsModalOpen(false);
      } catch (err) {
        console.error('Error deleting note', err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 dark:from-[#020617] dark:to-[#0f172a] text-slate-900 dark:text-white transition-all duration-300">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-indigo-500 to-cyan-500 bg-clip-text text-transparent">
              My Notes Calendar
            </h1>

            <p className="text-sm text-slate-500 mt-1 hidden sm:block">
              Smart note scheduling dashboard
            </p>
          </div>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-3 rounded-2xl bg-white dark:bg-slate-800 shadow-lg hover:scale-105 transition"
          >
            {darkMode ? (
              <Sun className="w-5 h-5 text-yellow-400" />
            ) : (
              <Moon className="w-5 h-5 text-slate-700" />
            )}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3 sm:p-6">
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] sm:rounded-[32px] shadow-2xl border border-slate-200 dark:border-slate-800 p-3 sm:p-6 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40">
                <CalendarDays className="w-6 h-6 text-indigo-600" />
              </div>

              <div>
                <h2 className="font-bold text-lg sm:text-xl">
                  Your Schedule
                </h2>

                <p className="text-sm text-slate-500">
                  Organize your workflow beautifully
                </p>
              </div>
            </div>

            <div className="text-sm text-slate-500">
              {notes.length} Notes
            </div>
          </div>

          <div className="h-[650px] sm:h-[780px] overflow-x-auto">
            <Calendar
              localizer={localizer}
              events={notes}
              startAccessor="start"
              endAccessor="end"
              selectable
              popup
              step={30}
              longPressThreshold={10}
              showMultiDayTimes
              date={currentDate}
              view={currentView}
              views={[
                Views.MONTH,
                Views.WEEK,
                Views.DAY,
                Views.AGENDA,
              ]}
              defaultView={Views.MONTH}
              onNavigate={(date) =>
                setCurrentDate(date)
              }
              onView={(view) =>
                setCurrentView(view)
              }
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              components={{
                toolbar: (props) => (
                  <CustomToolbar {...props} />
                ),
              }}
              eventPropGetter={(event) => {
                const color = getEventColor(
                  event.id
                );

                return {
                  style: {
                    background: color.bg,
                    borderRadius: '12px',
                    boxShadow: `0 4px 12px ${color.shadow}`,
                    border: 'none',
                    fontWeight: 600,
                  },
                };
              }}
              className="modern-calendar"
            />
          </div>
        </div>
      </main>

      {/* Floating Action Button */}
      <button
        onClick={() => {
          const now = moment();

          const remainder = 30 - (now.minute() % 30);

          const rounded =
            remainder === 30
              ? now.clone().seconds(0)
              : now.clone().add(remainder, 'minutes').seconds(0);

          handleSelectSlot({
            start: rounded.toDate(),
            end: rounded.clone().add(1, 'hour').toDate(),
          });
        }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-2xl flex items-center justify-center md:hidden hover:scale-105 transition"
      >
        <Plus className="w-6 h-6" />
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-[24px] sm:rounded-[32px] shadow-2xl border border-slate-200 dark:border-slate-700 p-6 relative">
            <button
              onClick={() =>
                setIsModalOpen(false)
              }
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-700"
            >
              <X />
            </button>

            <h3 className="text-2xl font-bold mb-2">
              {selectedEvent
                ? 'Edit Note'
                : 'Create Note'}
            </h3>

            <p className="text-sm text-slate-500 mb-5">
              {moment(selectedSlot).format(
                'dddd, MMMM Do YYYY'
              )}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-5">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Start time
                </label>

                <input
                  type="time"
                  value={startTime}
                  onChange={(e) =>
                    setStartTime(e.target.value)
                  }
                  className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-transparent p-3 outline-none focus:ring-2 ring-indigo-500"
                />
              </div>

              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  End time
                </label>

                <input
                  type="time"
                  value={endTime}
                  onChange={(e) =>
                    setEndTime(e.target.value)
                  }
                  className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-transparent p-3 outline-none focus:ring-2 ring-indigo-500"
                />
              </div>
            </div>

            <textarea
              className="w-full h-36 rounded-2xl border border-slate-300 dark:border-slate-700 bg-transparent p-4 outline-none focus:ring-2 ring-indigo-500 resize-none"
              placeholder="Write your note here..."
              value={noteText}
              onChange={(e) =>
                setNoteText(e.target.value)
              }
            />

            <label className="mt-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              <Image className="w-8 h-8 text-slate-400 mb-2" />

              <span className="text-sm text-slate-500 text-center">
                {selectedFile
                  ? selectedFile.name
                  : 'Upload attachment or image'}
              </span>

              <input
                type="file"
                className="hidden"
                onChange={(e) =>
                  setSelectedFile(
                    e.target.files[0]
                  )
                }
              />
            </label>

            {selectedEvent?.imageUrl && (
              <img
                src={selectedEvent.imageUrl}
                alt="Note"
                className="w-full h-44 object-cover rounded-2xl mt-4"
              />
            )}

            <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between mt-6">
              {selectedEvent ? (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 text-red-500 hover:text-red-600 font-semibold"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              ) : (
                <div />
              )}

              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button
                  onClick={() =>
                    setIsModalOpen(false)
                  }
                  className="px-5 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:opacity-80"
                >
                  Cancel
                </button>

                <button
                  onClick={handleSaveOrUpdate}
                  className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-lg"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}