sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, DateFormat
) {
    "use strict";

    var oDateFmt = DateFormat.getDateTimeInstance({ style: "medium" });

    return Controller.extend("mdm.portal.controller.FieldGroupDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        // ── Formatter: safe icon src ─────────────────────────────────
        formatIcon: function (sIcon) {
            if (sIcon && typeof sIcon === "string" && sIcon.indexOf("sap-icon://") === 0) {
                return sIcon;
            }
            return "sap-icon://folder";
        },

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy            : false,
                isNew           : false,
                isDirty         : false,
                selectedTab     : "general",
                subGroupCount   : "0",
                assignedFieldCount: "0"
            });
            this.getView().setModel(this._oViewModel, "view");

            // Sub-groups and assigned fields are held in JSON models
            // (populated on demand when tabs are selected)
            this.getView().setModel(new JSONModel({ items: [] }), "subGroups");
            this.getView().setModel(new JSONModel({ items: [] }), "assignedFields");

            this._loadLookups();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("fieldGroupDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Lookup data ───────────────────────────────────────────────
        _loadLookups: function () {
            var oModel        = this.getOwnerComponent().getModel();
            var oLookupsModel = new JSONModel({
                masterDataTypes : [],
                parentGroups    : [{ key: "", text: "— (Main Group)" }]
            });
            this.getView().setModel(oLookupsModel, "lookups");

            // Master data types
            oModel.bindList("/MasterDataTypes", null, [new Sorter("sequence")])
                .requestContexts(0, 50)
                .then(function (aCtx) {
                    oLookupsModel.setProperty("/masterDataTypes",
                        aCtx.map(function (c) {
                            return {
                                key : c.getProperty("master_data_type_id"),
                                text: c.getProperty("description")
                            };
                        })
                    );
                });

            // Parent groups (main groups only — no parent themselves)
            oModel.bindList("/FieldGroups", null, [new Sorter("sequence")])
                .requestContexts(0, 200)
                .then(function (aCtx) {
                    var aItems = [{ key: "", text: "— (Main Group)" }];
                    aCtx.forEach(function (c) {
                        if (!c.getProperty("parent_group_id_group_id")) {
                            aItems.push({
                                key : c.getProperty("group_id"),
                                text: c.getProperty("group_id") + " — " + c.getProperty("description")
                            });
                        }
                    });
                    oLookupsModel.setProperty("/parentGroups", aItems);
                });
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var sRaw     = decodeURIComponent(oEvent.getParameter("arguments").groupId);
            // Preserve NEW / NEW_SUB_ prefixes as-is; uppercase only real IDs
            var sGroupId = (sRaw === "NEW" || sRaw.startsWith("NEW_SUB_"))
                ? sRaw
                : sRaw.toUpperCase();

            // Clear any pending/retrying create or patch left over from a previous
            // failed save or copy, so a stuck row cannot keep colliding on the key.
            try { this.getOwnerComponent().getModel().resetChanges("fieldGroupUpdate"); } catch (e) { /* no pending */ }

            // Reset state
            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("subGroups").setProperty("/items", []);
            this.getView().getModel("assignedFields").setProperty("/items", []);

            if (sGroupId === "NEW") {
                this._createNew(null);
            } else if (sGroupId.startsWith("NEW_SUB_")) {
                // Pre-filled sub-group — parent extracted from key
                var sParentId = decodeURIComponent(sGroupId.replace("NEW_SUB_", ""));
                this._createNew(sParentId);
            } else {
                this._bindGroup(sGroupId);
            }
        },

        // ── Bind existing group ───────────────────────────────────────
        _bindGroup: function (sGroupId) {
            this._oViewModel.setProperty("/isNew",  false);
            this._oViewModel.setProperty("/busy",   true);

            var sPath = "/FieldGroups('" + sGroupId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    // $select must include every property the form writes back, or
                    // OData v4 rejects the write ("Must not change a property before
                    // it has been read"). FK scalars are listed explicitly.
                    $select        : "group_id,description,icon,sequence,active," +
                                     "master_data_type_master_data_type_id,parent_group_id_group_id",
                    // Only expand master_data_type. parent_group_id is read from
                    // the FK field (parent_group_id_group_id) directly — expanding a
                    // null association breaks the bind for Main Groups.
                    $expand        : "master_data_type($select=master_data_type_id,description,object_class)",
                    $$updateGroupId: "fieldGroupUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        // Surface any request error instead of silently bouncing
                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load group: " + (oError.message || "Unknown error"));
                            return;
                        }

                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Group not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);
                            var oSel = this.byId("selMasterDataType");
                            if (oSel) {
                                oSel.setSelectedKey(oData.master_data_type_master_data_type_id);
                            }
                            var oParSel = this.byId("selParentGroup");
                            if (oParSel) {
                                oParSel.setSelectedKey(oData.parent_group_id_group_id || "");
                            }
                        }.bind(this));
                        // Group ID should not be changed on edit
                        this.byId("inGroupId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function (sPresetParentId) {
            this._oViewModel.setProperty("/isNew",  true);
            this._oViewModel.setProperty("/busy",   false);

            // If we arrived here from Copy, the view still has the object binding
            // of the source record (set by _bindGroup via bindObject). That binding
            // wins over setBindingContext, so unbind it before pointing the view at
            // the new transient row. No-op (safe) on the plain "New" route.
            this.getView().unbindObject();

            var oModel   = this.getOwnerComponent().getModel();
            // Bind the list to the SAME update group used by onSave's submitBatch,
            // otherwise the new record is never flushed by submitBatch("fieldGroupUpdate").
            var oListBinding = oModel.bindList("/FieldGroups", null, [], [], {
                $$updateGroupId: "fieldGroupUpdate"
            });
            // Default the required Master Data Type to the first loaded lookup so
            // the record never carries an empty NOT NULL field before the user picks.
            var aMDT = this.getView().getModel("lookups").getProperty("/masterDataTypes") || [];
            var sDefaultMDT = aMDT.length ? aMDT[0].key : "";
            var oContext = oListBinding.create({
                group_id                        : "",
                description                     : "",
                icon                            : "sap-icon://group",
                sequence                        : 1,
                active                          : true,
                master_data_type_master_data_type_id: sDefaultMDT,
                parent_group_id_group_id        : sPresetParentId || null
            });
            // Keep a reference so onSave can detect create vs edit
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            if (sDefaultMDT) { this.byId("selMasterDataType").setSelectedKey(sDefaultMDT); }
            this._refreshHeader({
                group_id                : "",
                description             : "",
                active                  : true,
                parent_group_id_group_id: sPresetParentId || null
            });
            this.byId("inGroupId").setEditable(true);

            // Pre-select parent if provided
            if (sPresetParentId) {
                this.byId("selParentGroup").setSelectedKey(sPresetParentId);
                this._updateParentHint(sPresetParentId);
            }
        },

        // ── Header refresh ────────────────────────────────────────────
        _refreshHeader: function (oData) {
            var sGroupId = oData.group_id || "";
            var sDesc    = oData.description || "";
            var sTitle   = sGroupId
                ? (sGroupId + (sDesc ? " — " + sDesc : ""))
                : "New Group";

            this.byId("pageTitle").setText(sTitle);

            // Update breadcrumb last item
            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) {
                oBreadcrumb.setCurrentLocationText(sGroupId || "New Group");
            }

            // Icon preview is handled by the {icon} binding on the control —
            // do NOT set it imperatively or OData v4 throws
            // "Must not change a property before it has been read".

            // Subtitle: "Main group · Business Partner · 2 sub groups · 18 assigned fields"
            var sType    = oData.parent_group_id_group_id ? "Sub group" : "Main group";
            var sSubtitle = sType;
            if (oData.master_data_type && oData.master_data_type.description) {
                sSubtitle += " · " + oData.master_data_type.description;
            }
            this.byId("pageSubtitle").setText(sSubtitle);

            // Status strip
            this.byId("attrStatus").setText(oData.active ? "Active" : "Inactive");
            this.byId("attrStatus").setState(oData.active ? "Success" : "Error");
            this.byId("attrType").setText(sType);
            this.byId("attrParent").setText(
                oData.parent_group_id_group_id
                    ? oData.parent_group_id_group_id
                    : "— (Main Group)"
            );
            if (oData.sequence !== undefined) {
                this.byId("attrSequence").setText(String(oData.sequence));
            }
        },

        // ── Field change (dirty flag) ────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        onIconLiveChange: function (oEvent) {
            var sSrc = oEvent.getParameter("value");
            var oIcon = this.byId("iconPreview");
            try {
                oIcon.setSrc(sSrc);
            } catch (e) {
                // Invalid icon string — just leave the preview
            }
            this._oViewModel.setProperty("/isDirty", true);
        },

        onParentGroupChange: function (oEvent) {
            var sKey = oEvent.getSource().getSelectedKey();
            this._updateParentHint(sKey);
            this._oViewModel.setProperty("/isDirty", true);
        },

        _updateParentHint: function (sParentKey) {
            var oHint = this.byId("parentGroupHint");
            if (!oHint) { return; }
            if (sParentKey) {
                oHint.setText("This will be created as a Sub Group under " + sParentKey + ".");
            } else {
                oHint.setText("Leave blank to create a Main Group.");
            }
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "subGroups")     { this._loadSubGroups(); }
            if (sKey === "assignedFields") { this._loadAssignedFields(); }
            if (sKey === "changelog")      { this._loadChangeLog(); }
        },

        // ── Sub-groups tab ───────────────────────────────────────────
        _loadSubGroups: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sGroupId = oCtx.getProperty("group_id");
            if (!sGroupId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/FieldGroups", null, [new Sorter("sequence")], [
                new Filter("parent_group_id_group_id", FilterOperator.EQ, sGroupId)
            ]).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        group_id   : c.getProperty("group_id"),
                        description: c.getProperty("description"),
                        sequence   : c.getProperty("sequence"),
                        active     : c.getProperty("active")
                    };
                });
                this.getView().getModel("subGroups").setProperty("/items", aItems);
                this._oViewModel.setProperty("/subGroupCount", String(aItems.length));
                this.byId("attrSubCount").setText(String(aItems.length));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load sub groups: " + e.message);
            });
        },

        onSubGroupRowPress: function (oEvent) {
            var sGroupId = oEvent.getSource().getBindingContext("subGroups").getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: encodeURIComponent(sGroupId.toLowerCase())
            });
        },

        onSubGroupLinkPress: function (oEvent) {
            var sGroupId = oEvent.getSource().getBindingContext("subGroups").getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: encodeURIComponent(sGroupId.toLowerCase())
            });
        },

        onAddSubGroup: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sGroupId = oCtx.getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: "NEW_SUB_" + encodeURIComponent(sGroupId)
            });
        },

        // ── Assigned fields tab ──────────────────────────────────────
        _loadAssignedFields: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sGroupId = oCtx.getProperty("group_id");
            if (!sGroupId) { return; }

            var bIsMain  = !oCtx.getProperty("parent_group_id_group_id");
            var oModel   = this.getOwnerComponent().getModel();

            // For a MAIN group, also include fields belonging to its sub-groups
            // (in this data model fields are mostly assigned at sub-group level).
            // Step 1: collect the set of group IDs to match against.
            var pGroupIds;
            if (bIsMain) {
                pGroupIds = oModel.bindList("/FieldGroups", null, null, [
                    new Filter("parent_group_id_group_id", FilterOperator.EQ, sGroupId)
                ], {
                    $select: "group_id"
                }).requestContexts(0, Infinity).then(function (aSubs) {
                    var aIds = aSubs.map(function (c) { return c.getProperty("group_id"); });
                    aIds.push(sGroupId); // include the main group itself
                    return aIds;
                });
            } else {
                pGroupIds = Promise.resolve([sGroupId]);
            }

            // Step 2: load fields where main_group OR sub_group is any of those IDs.
            pGroupIds.then(function (aGroupIds) {
                var aGroupFilters = [];
                aGroupIds.forEach(function (sId) {
                    aGroupFilters.push(new Filter("main_group_group_id", FilterOperator.EQ, sId));
                    aGroupFilters.push(new Filter("sub_group_group_id",  FilterOperator.EQ, sId));
                });

                return oModel.bindList("/FieldMasters", null, [new Sorter("field_id")], [
                    new Filter({ filters: aGroupFilters, and: false })
                ], {
                    $select: "field_id,description,data_type,display_type,active,main_group_group_id,sub_group_group_id"
                }).requestContexts(0, Infinity);
            }).then(function (aCtx) {
                // De-duplicate (a field could match on both main and sub group)
                var oSeen  = {};
                var aItems = [];
                aCtx.forEach(function (c) {
                    var sFid = c.getProperty("field_id");
                    if (oSeen[sFid]) { return; }
                    oSeen[sFid] = true;
                    aItems.push({
                        field_id    : sFid,
                        description : c.getProperty("description"),
                        data_type   : c.getProperty("data_type"),
                        display_type: c.getProperty("display_type"),
                        active      : c.getProperty("active")
                    });
                });
                this.getView().getModel("assignedFields").setProperty("/items", aItems);
                this._oViewModel.setProperty("/assignedFieldCount", String(aItems.length));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load fields: " + e.message);
            });
        },

        onFieldRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assignedFields").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId.toLowerCase())
            });
        },

        onFieldLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assignedFields").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId.toLowerCase())
            });
        },

        // ── Change log tab ───────────────────────────────────────────
        _loadChangeLog: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sGroupId = oCtx.getProperty("group_id");
            if (!sGroupId) { return; }

            // Populate managed-field strip
            var oVm = this._oViewModel;
            oVm.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
            oVm.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "\u2014");
            oVm.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
            oVm.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "\u2014");

            var oTable   = this.byId("logTable");
            var oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "FieldGroup"),
                new Filter("entity_key",  FilterOperator.EQ, sGroupId)
            ]);
            oBinding.resume();
        },

        _fmtDate: function (sVal) {
            if (!sVal) { return "\u2014"; }
            try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sGroupId = this.byId("inGroupId").getValue().trim().toUpperCase();
            var sDesc    = this.byId("inDescription").getValue().trim();
            var sMDT     = this.byId("selMasterDataType").getSelectedKey();
            var sSeq     = this.byId("inSequence").getValue().trim();

            // Basic validation
            if (!sGroupId) {
                MessageBox.error("Field Group Name is required.");
                return;
            }
            if (!/^[A-Z0-9_]+$/.test(sGroupId)) {
                MessageBox.error("Field Group Name must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc) {
                MessageBox.error("Description is required.");
                return;
            }
            if (!sMDT) {
                MessageBox.error("Master Data Type is required.");
                return;
            }
            if (!sSeq || isNaN(parseInt(sSeq, 10))) {
                MessageBox.error("A valid Sequence number is required.");
                return;
            }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");

            var oCtx = this.getView().getBindingContext();
            if (oCtx) {
                // group_id, description, sequence, icon are TWO-WAY bound in the
                // view, so their edits are already pending — do NOT set them here.
                // Only the two Select controls are unbound and must be written back.
                //
                // group_id is the KEY: it may only be set on a TRANSIENT context
                // (a pending create that has not yet been POSTed). Writing it on a
                // persisted record tries to change its primary key → UNIQUE error.
                var bTransient = (typeof oCtx.isTransient === "function") && oCtx.isTransient();
                if (bIsNew && bTransient) {
                    oCtx.setProperty("group_id", sGroupId);
                }
                // master_data_type is NOT NULL — only write a non-empty value so we
                // never accidentally clear it on an existing record.
                if (sMDT) {
                    oCtx.setProperty("master_data_type_master_data_type_id", sMDT);
                }
                // parent is nullable (main groups have none). Only write it on a
                // transient create or when it actually changed, to avoid issuing a
                // key-touching PATCH on a persisted row.
                if (bTransient) {
                    oCtx.setProperty("parent_group_id_group_id",
                        this.byId("selParentGroup").getSelectedKey() || null);
                }
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("fieldGroupUpdate")
                .then(function () {
                    // For a new record, wait for the server to confirm creation.
                    // oCtx.created() returns a Promise only on a transient context;
                    // guard against it being undefined (already settled / plain ctx).
                    if (bIsNew && oCtx && typeof oCtx.created === "function") {
                        var pCreated = oCtx.created();
                        if (pCreated && typeof pCreated.then === "function") {
                            return pCreated.then(function () { return true; });
                        }
                        return true;
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Group saved successfully.");

                    if (bWasCreated) {
                        // Navigate back to the list so it reloads with the new row.
                        // Delay slightly so the toast actually paints before the
                        // route change tears the page down.
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        // Edit — refresh header from the saved data
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("fieldGroupUpdate");
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);

            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { fnGoBack(); }
                    }
                });
            } else {
                fnGoBack();
            }
        },

        // ── Copy ─────────────────────────────────────────────────────
        onCopy: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) {
                MessageToast.show("No group selected to copy.");
                return;
            }
            // Clear any stale pending create/patch from a previous copy attempt.
            this.getOwnerComponent().getModel().resetChanges("fieldGroupUpdate");
            oCtx.requestObject().then(function (oData) {
                // Reuse the standard new-record flow (which defers the create to
                // the fieldGroupUpdate batch — no premature blank-ID POST), then
                // pre-fill it with the copied values.
                this._createNew(oData.parent_group_id_group_id || null);

                var oNewCtx = this.getView().getBindingContext();
                if (oNewCtx) {
                    oNewCtx.setProperty("description", oData.description + " (Copy)");
                    oNewCtx.setProperty("icon", oData.icon || "sap-icon://group");
                    oNewCtx.setProperty("sequence", (oData.sequence || 0) + 1);
                    oNewCtx.setProperty("active", false);
                    if (oData.master_data_type_master_data_type_id) {
                        oNewCtx.setProperty("master_data_type_master_data_type_id",
                            oData.master_data_type_master_data_type_id);
                    }
                }

                this.byId("selMasterDataType").setSelectedKey(oData.master_data_type_master_data_type_id || "");
                this.byId("selParentGroup").setSelectedKey(oData.parent_group_id_group_id || "");
                this._oViewModel.setProperty("/isDirty", true);

                this._refreshHeader({
                    group_id   : "",
                    description: oData.description + " (Copy)",
                    active     : false,
                    parent_group_id_group_id: oData.parent_group_id_group_id
                });

                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Group copied — enter a new Field Group Name and press Save.");
            }.bind(this));
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("fieldGroups");
        }
    });
});