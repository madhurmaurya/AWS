import React, { useState, useEffect } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import { Sun, Moon, Trash2, Image, X } from 'lucide-react';
import axios from 'axios';

// Import CSS variables required by the calendar component library
import 'react-big-calendar/lib/css/react-big-calendar.css';

const localizer = momentLocalizer(moment);
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5213/api/notes';

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [notes, setNotes] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Form Fields State
  const [noteText, setNoteText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => { fetchNotes(); }, []);

  const fetchNotes = async () => {
    try {
      const res = await axios.get(API_BASE);
      // Map API notes payload objects straight into calendar events structural signatures
      const formattedEvents = res.data.map(note => ({
        id: note.id,
        title: note.content,
        start: new Date(note.noteDate),
        end: new Date(note.noteDate),
        allDay: true,
        imageUrl: note.imageUrl
      }));
      setNotes(formattedEvents);
    } catch (err) { console.error("Error loading notes", err); }
  };

  const handleSelectSlot = ({ start }) => {
    setSelectedSlot(start);
    setSelectedEvent(null);
    setNoteText('');
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event);
    setSelectedSlot(event.start);
    setNoteText(event.title);
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const handleSaveOrUpdate = async () => {
    const formData = new FormData();
    const formattedDate = moment(selectedSlot).format('YYYY-MM-DD');
    formData.append('content', noteText);
    formData.append('noteDate', formattedDate);
    if (selectedFile) formData.append('image', selectedFile);

    try {
      if (selectedEvent) {
        await axios.put(`${API_BASE}/${selectedEvent.id}`, formData);
      } else {
        await axios.post(API_BASE, formData);
      }
      fetchNotes();
      setIsModalOpen(false);
    } catch (err) { console.error("Error synchronizing tracking entry", err); }
  };

  const handleDelete = async () => {
    if (window.confirm("Permanently erase note entry?")) {
      try {
        await axios.delete(`${API_BASE}/${selectedEvent.id}`);
        fetchNotes();
        setIsModalOpen(false);
      } catch (err) { console.error("Error erasing resource target", err); }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors duration-300">
      <header className="flex justify-between items-center p-6 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-500 to-blue-600 bg-clip-text text-transparent">
          My Notes Calendar
        </h1>
        <button 
          onClick={() => setDarkMode(!darkMode)}
          className="p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:ring-2 ring-indigo-500 transition-all duration-200"
        >
          {darkMode ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-slate-600" />}
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-6 bg-white dark:bg-slate-900 mt-6 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800">
        <div className="h-[750px] p-2 text-slate-700 dark:text-slate-300">
          <Calendar
            localizer={localizer}
            events={notes}
            startAccessor="start"
            endAccessor="end"
            defaultView="month"
            views={['month']}
            selectable
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            className="rounded-xl overflow-hidden shadow-inner font-sans"
            eventPropGetter={() => ({
              className: "bg-indigo-600 text-white rounded-lg px-2 py-1 text-xs font-semibold border-none shadow-sm"
            })}
          />
        </div>
      </main>

      {/* Dynamic Slide-in Focus Modal Component */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 p-6 relative">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X /></button>
            <h3 className="text-lg font-bold mb-4">{selectedEvent ? "Edit Note" : "Create New Note"}</h3>
            
            <textarea 
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent mb-4 focus:ring-2 ring-indigo-500 outline-none resize-none h-28"
              placeholder="Write structural note criteria description here..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />

            <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition mb-4">
              <Image className="w-8 h-8 text-slate-400 mb-1" />
              <span className="text-xs text-slate-500">{selectedFile ? selectedFile.name : "Attach feature image configuration"}</span>
              <input type="file" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0])} />
            </label>

            {selectedEvent?.imageUrl && (
              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-1">Attached Graphic Asset:</p>
                <img src={selectedEvent.imageUrl} alt="Attached Asset" className="w-full h-32 object-cover rounded-xl border border-slate-200 dark:border-slate-700" />
              </div>
            )}

            <div className="flex justify-between items-center mt-6">
              {selectedEvent ? (
                <button onClick={handleDelete} className="flex items-center gap-1 text-sm font-semibold text-red-500 hover:text-red-600">
                  <Trash2 className="w-4 h-4" /> Erase Note
                </button>
              ) : <div />}
              
              <div className="flex gap-2">
                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">Dismiss</button>
                <button onClick={handleSaveOrUpdate} className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md">Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}