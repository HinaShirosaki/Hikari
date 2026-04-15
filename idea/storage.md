
## Storage Design Notes

- Create three top-level folders under the user-defined root directory: **Papers**, **Assays**, and **Gels**.

- For gels or assays created from, or linked to, a notebook page:
  - Create dedicated **gel** and/or **assay** subfolders inside that notebook page folder.
  - Store all related assets in the appropriate subfolder, including:
    - image files
    - assay definition JSON
    - analysis result JSON
    - other generated outputs

- Files and user data must **not** be stored in the system Application Support directory.

- Each notebook page should be stored as an **individual folder**.

- Maintain metadata, indexing, and status records in SQLite.

- Maintain the status of stored papers in SQLite.

- Add an automatic paper discovery function:
  - When the Papers module is opened, scan all paper folders.
  - This includes global paper folders as well as paper folders inside workflows and projects.
  - Automatically register any newly discovered papers into the database.

- Chemical inventory should use a **separate SQLite database file** to simplify export and import.

- Other modules may share a common database file.