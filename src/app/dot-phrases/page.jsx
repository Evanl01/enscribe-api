"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/public/scripts/api.js";
import * as format from "@/public/scripts/format.js";
import Auth from "@/src/components/Auth.jsx";

export default function DotPhrases() {
  const router = useRouter();
  const [dotPhrases, setDotPhrases] = useState([]);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [editValues, setEditValues] = useState({ trigger: "", expansion: "" });
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  useEffect(() => {
    fetchDotPhrases();
  }, []);

  const fetchDotPhrases = async () => {
    const jwt = api.getJWT();
    if (!jwt) {
      router.push("/login");
      return;
    }
    try {
      const response = await fetch("/api/dotPhrases", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        router.push("/login");
        return;
      }
      const data = await response.json();
      setDotPhrases(data);
    } catch (error) {
      router.push("/login");
    }
  };

  const handleEditClick = (dotPhrase) => {
    setSelectedRowId(dotPhrase.id);
    setEditValues({ trigger: dotPhrase.trigger, expansion: dotPhrase.expansion });
    setIsCreatingNew(false);
  };

  const handleDeleteClick = async (dotPhrase) => {
    if (confirm(`Are you sure you want to delete the dot phrase "${dotPhrase.trigger}"?`)) {
      const jwt = api.getJWT();
      try {
        const response = await fetch(`/api/dot-phrases/${dotPhrase.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
        });
        if (response.ok) {
          window.location.reload();
        }
      } catch (error) {
        console.error("Delete failed:", error);
      }
    }
  };

  const handleSave = async () => {
    const jwt = api.getJWT();
    try {
      const method = isCreatingNew ? "POST" : "PATCH";
      const endpoint = isCreatingNew ? "/api/dot-phrases" : `/api/dot-phrases/${selectedRowId}`;
      const body = {
        trigger: editValues.trigger,
        expansion: editValues.expansion,
      };

      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Save failed:", error);
    }
  };

  const handleCancel = () => {
    setSelectedRowId(null);
    setIsCreatingNew(false);
    setEditValues({ trigger: "", expansion: "" });
  };

  const handleCreateNew = () => {
    setIsCreatingNew(true);
    setSelectedRowId(null);
    setEditValues({ trigger: "", expansion: "" });
  };

  const truncateText = (text, maxLength = 50) => {
    if (!text) return "";
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
  };

  return (
    <>
      <Auth />
      <div className="max-w-8xl mx-auto p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">
            Dot Phrases ({dotPhrases.length})
          </h1>
        </div>

        {/* Headers */}
        <div className="bg-gray-50 p-4 rounded-t-lg">
          <div className="grid grid-cols-2 gap-4">
            <div className="font-semibold text-gray-700">Dot Phrase</div>
            <div className="font-semibold text-gray-700">Full Text</div>
          </div>
        </div>

        {/* Dot Phrases List */}
        <div className="bg-white border border-gray-200 rounded-b-lg">
          {dotPhrases.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No dot phrases found. Create your first one below!
            </div>
          ) : (
            dotPhrases.map((dotPhrase) => (
              <div key={dotPhrase.id}>
                {/* Normal Row */}
                {selectedRowId !== dotPhrase.id && (
                  <div
                    className="p-4 border-b border-gray-100 hover:bg-gray-50 group cursor-pointer transition-colors"
                    data-dot-phrase-id={dotPhrase.id}
                  >
                    <div className="grid grid-cols-2 gap-4 items-center">
                      <p className="text-gray-800">
                        {truncateText(dotPhrase.trigger)}
                      </p>
                      <div className="flex justify-between items-center">
                        <p className="text-gray-800">
                          {truncateText(dotPhrase.expansion)}
                        </p>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                          <button
                            onClick={() => handleEditClick(dotPhrase)}
                            className="w-8 h-8 bg-gray-300 hover:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-colors"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteClick(dotPhrase)}
                            className="w-8 h-8 bg-gray-300 hover:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-colors"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Edit Row */}
                {selectedRowId === dotPhrase.id && (
                  <div className="p-4 border-b border-gray-100 bg-gray-100">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <input
                          type="text"
                          value={editValues.trigger}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              trigger: e.target.value.substring(0, 50),
                            })
                          }
                          className="w-full p-2 border border-gray-300 rounded-lg"
                          placeholder="Dot phrase trigger"
                          maxLength={50}
                        />
                      </div>
                      <div>
                        <textarea
                          value={editValues.expansion}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              expansion: e.target.value,
                            })
                          }
                          className="w-full p-2 border border-gray-300 rounded-lg"
                          placeholder="Full text expansion"
                          rows="4"
                          style={{ whiteSpace: "pre-wrap" }}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={handleCancel}
                        className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {/* New Dot Phrase Row */}
          {isCreatingNew && (
            <div className="p-4 border-b border-gray-100 bg-gray-100">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input
                    type="text"
                    value={editValues.trigger}
                    onChange={(e) =>
                      setEditValues({
                        ...editValues,
                        trigger: e.target.value.substring(0, 50),
                      })
                    }
                    className="w-full p-2 border border-gray-300 rounded-lg"
                    placeholder="Dot phrase trigger"
                    maxLength={50}
                  />
                </div>
                <div>
                  <textarea
                    value={editValues.expansion}
                    onChange={(e) =>
                      setEditValues({
                        ...editValues,
                        expansion: e.target.value,
                      })
                    }
                    className="w-full p-2 border border-gray-300 rounded-lg"
                    placeholder="Full text expansion"
                    rows="4"
                    style={{ whiteSpace: "pre-wrap" }}
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Create New Button */}
        <div className="mt-6 text-center">
          <button
            onClick={handleCreateNew}
            disabled={isCreatingNew || selectedRowId !== null}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg transition-colors"
          >
            Create New Dot Phrase
          </button>
        </div>
      </div>
    </>
  );
}
