sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/Select",
    "sap/m/Switch",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (
    Controller, JSONModel, Filter, FilterOperator,
    MessageToast, MessageBox, Dialog, Button, Input, Label, Select, Switch, Item, SimpleForm
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseCodeDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy       : false,
                isNew      : false,
                isDirty    : false,
                selectedTab: "general",
                userCount  : "0",
                scopeCount : "0",
                usageCount : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "usage");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("releaseCodeDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var sRaw  = decodeURIComponent(oArgs.codeId);
            var sId   = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();

            try { this.getOwnerComponent().getModel().resetChanges("releaseCodeUpdate"); } catch (e) { /* no pending */ }
            try { this.getOwnerComponent().getModel().resetChanges("releaseCodeUsersUpdate"); } catch (e) { /* no pending */ }
            try { this.getOwnerComponent().getModel().resetChanges("releaseCodeScopeUpdate"); } catch (e) { /* no pending */ }

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this._oViewModel.setProperty("/userCount", "0");
            this._oViewModel.setProperty("/scopeCount", "0");
            this._oViewModel.setProperty("/usageCount", "0");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("usage").setProperty("/items", []);

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindReleaseCode(sId);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindReleaseCode: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            // ReleaseCode has a single-column key (release_code_id), unlike
            // StrategyCharacteristic / ReleaseStrategy which are composite —
            // no extra key parts needed in the path here.
            var sPath = "/ReleaseCodes(release_code_id='" + encodeURIComponent(sId) + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select: "release_code_id,description,master_data_type_master_data_type_id," +
                             "sla_hours,escalation_to,escalation_hours,active," +
                             "createdAt,createdBy,modifiedAt,modifiedBy",
                    $$updateGroupId: "releaseCodeUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load release code: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Release code not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);

                            var oSelAppliesTo = this.byId("selAppliesTo");
                            if (oSelAppliesTo) { oSelAppliesTo.setSelectedKey(oData.master_data_type_master_data_type_id || ""); }

                            // Switch's "state" isn't two-way bound in this view
                            // (deliberate — matches the rest of this codebase's
                            // pattern of setting toggle controls imperatively),
                            // so sync it explicitly here and read it back the
                            // same way on Save.
                            var oSwActive = this.byId("swActive");
                            if (oSwActive) { oSwActive.setState(oData.active !== false); }

                            // Load tab badge data eagerly, right when the record
                            // loads — not lazily on tab-select — so all three
                            // tab counts are correct immediately.
                            this._loadUserCount();
                            this._loadScopeCount();
                            this._loadUsage();
                        }.bind(this));

                        this.byId("inId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  true);

            this.getView().unbindObject();

            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/ReleaseCodes", null, [], [], {
                $$updateGroupId: "releaseCodeUpdate"
            });
            // Release Code IDs are short mnemonic codes the user types
            // themselves (e.g. MDS, RC_FIN) rather than an auto-generated
            // sequence, so the key starts blank and is set from the input
            // at Save time — same approach ReleaseCriteriaDetail uses for
            // its own key property on a freshly created context.
            var oContext = oListBinding.create({
                release_code_id : "",
                description     : "",
                sla_hours       : 24,
                escalation_to   : null,
                escalation_hours: null,
                active          : true,
                master_data_type_master_data_type_id: null
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ release_code_id: "", description: "", active: true, sla_hours: 24 });

            this.byId("selAppliesTo").setSelectedKey("");
            this.byId("swActive").setState(true);
            this.byId("inId").setEditable(true);
            this._oViewModel.setProperty("/busy", false);
        },

        // ── Header refresh ───────────────────────────────────────────
        _refreshHeader: function (oData) {
            var oView = this.getView();
            if (!oView || oView.bIsDestroyed) { return; }

            var sId    = oData.release_code_id || "";
            var sDesc  = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " \u2014 " + sDesc : "")) : "New Release Code";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oStatus = this.byId("attrStatus");
            if (oStatus) {
                var bActive = oData.active !== false;
                oStatus.setText(bActive ? "Active" : "Inactive");
                oStatus.setState(bActive ? "Success" : "Error");
            }

            var oSla = this.byId("attrSla");
            if (oSla) {
                oSla.setText(oData.sla_hours ? (oData.sla_hours + " hours") : "\u2014");
            }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            // Data is already loaded eagerly on bind; re-fetch on tab-select
            // too so the tab reflects any change made elsewhere in the same
            // session (e.g. a user assigned from another tab's dialog).
            if (sKey === "users")     { this._loadUserCount(); }
            if (sKey === "scope")     { this._loadScopeCount(); }
            if (sKey === "usage")     { this._loadUsage(); }
            if (sKey === "changelog") { this._loadChangeLog(); }
        },

        // ── Change Log tab ───────────────────────────────────────────
        _loadChangeLog: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("release_code_id");
            if (!sId) { return; }

            var oVm = this._oViewModel;
            oVm.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
            oVm.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "\u2014");
            oVm.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
            oVm.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "\u2014");

            // ReleaseCode has a single-column key, so the backend's
            // entity_key is just the raw id — no "::" composite separator
            // (see AUDIT_ENTITIES / auditBuildKey in mdm-service.js).
            var oTable   = this.byId("logTable");
            var oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "ReleaseCode"),
                new Filter("entity_key",  FilterOperator.EQ, sId)
            ]);
            oBinding.resume();
        },

        _fmtDate: function (sVal) {
            if (!sVal) { return "\u2014"; }
            try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
        },

        // ── Assigned Users tab ───────────────────────────────────────
        _loadUserCount: function () {
            var oTable = this.byId("usersTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iCount) {
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }
                    this._oViewModel.setProperty("/userCount", String(iCount || 0));
                }.bind(this)).catch(function () {
                    // New/unsaved record has no nav path yet — leave empty, no error.
                });
            }
        },

        _getLoadedUserRows: function () {
            var oTable = this.byId("usersTable");
            if (!oTable) { return []; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return []; }
            return oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
        },

        // Used by the Active column icon in the Users table.
        formatActiveIcon: function (bActive) {
            return bActive !== false ? "sap-icon://accept" : "sap-icon://decline";
        },

        formatActiveColor: function (bActive) {
            return bActive !== false ? "Positive" : "Negative";
        },

        onAddUser: function () {
            if (this._oViewModel.getProperty("/isNew")) {
                MessageToast.show("Save the release code first before assigning users.");
                return;
            }
            this._openUserDialog(null);
        },

        onUserRowPress: function (oEvent) {
            this._openUserDialog(oEvent.getSource().getBindingContext());
        },

        // oExistingCtx: null → "Add" mode (new user_id + type + active).
        //               a row's live context → "Edit" mode. user_id and
        //               release_code together form the row's key, so the
        //               User ID field is locked in edit mode — only
        //               Assignment Type and Active can be changed on an
        //               already-saved assignment (matches how OData V4
        //               key properties can't be PATCHed after creation).
        _openUserDialog: function (oExistingCtx) {
            var bEdit = !!oExistingCtx;

            if (!this._oUserDialog) {
                var oIdInput   = new Input({ placeholder: "e.g. jane.doe@company.com", maxLength: 80 });
                var oTypeSelect = new Select({
                    selectedKey: "USER",
                    items: [
                        new Item({ key: "USER",  text: "User" }),
                        new Item({ key: "GROUP", text: "Group" })
                    ]
                });
                var oActiveSwitch = new Switch({ state: true });

                this._oUserDialog = new Dialog({
                    title  : "Assign User",
                    content: new SimpleForm({
                        editable: true,
                        layout  : "ResponsiveGridLayout",
                        content : [
                            new Label({ text: "User ID", required: true }), oIdInput,
                            new Label({ text: "Assignment Type", required: true }), oTypeSelect,
                            new Label({ text: "Active" }), oActiveSwitch
                        ]
                    }),
                    beginButton: new Button({
                        text: "Add",
                        type: "Emphasized",
                        press: function () {
                            var sUserId = oIdInput.getValue().trim();
                            var sType   = oTypeSelect.getSelectedKey();
                            var bActive = oActiveSwitch.getState();
                            var oCtxBeingEdited = this._oUserDialog._oEditingCtx;

                            if (!sUserId) {
                                MessageBox.error("User ID is required.");
                                return;
                            }

                            if (!oCtxBeingEdited) {
                                var bDuplicate = this._getLoadedUserRows().some(function (o) {
                                    return o.user_id === sUserId;
                                });
                                if (bDuplicate) {
                                    MessageBox.error("User \"" + sUserId + "\" is already assigned to this release code.");
                                    return;
                                }
                                this._createUser(sUserId, sType, bActive);
                            } else {
                                this._updateUser(oCtxBeingEdited, sType, bActive);
                            }

                            this._oUserDialog.close();
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () { this._oUserDialog.close(); }.bind(this)
                    })
                });
                this._oUserDialog._oIdInput      = oIdInput;
                this._oUserDialog._oTypeSelect   = oTypeSelect;
                this._oUserDialog._oActiveSwitch = oActiveSwitch;
                this.getView().addDependent(this._oUserDialog);
            }

            this._oUserDialog._oEditingCtx = oExistingCtx;
            var oIdInput      = this._oUserDialog._oIdInput;
            var oTypeSelect   = this._oUserDialog._oTypeSelect;
            var oActiveSwitch = this._oUserDialog._oActiveSwitch;

            if (bEdit) {
                this._oUserDialog.setTitle("Edit User Assignment");
                this._oUserDialog.getBeginButton().setText("Save");
                oIdInput.setValue(oExistingCtx.getProperty("user_id"));
                oIdInput.setEditable(false);
                oTypeSelect.setSelectedKey(oExistingCtx.getProperty("assignment_type"));
                oActiveSwitch.setState(oExistingCtx.getProperty("active") !== false);
            } else {
                this._oUserDialog.setTitle("Assign User");
                this._oUserDialog.getBeginButton().setText("Add");
                oIdInput.setValue("");
                oIdInput.setEditable(true);
                oTypeSelect.setSelectedKey("USER");
                oActiveSwitch.setState(true);
            }

            this._oUserDialog.open();
        },

        _createUser: function (sUserId, sType, bActive) {
            var oTable = this.byId("usersTable");
            if (!oTable) { return; }
            var oListBinding = oTable.getBinding("items");
            if (!oListBinding) { return; }

            // Created through the table's own LIVE binding (not a freshly
            // manufactured, orphaned bindList) — release_code is inherited
            // implicitly from this nested composition context, the same
            // way StrategyCharacteristicValue rows inherit their parent
            // characteristic in ReleaseCriteriaDetail.controller.js.
            oListBinding.create({
                user_id        : sUserId,
                assignment_type: sType,
                active         : bActive
            });

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCodeUsersUpdate")
                .then(function () {
                    MessageToast.show("User assigned.");
                    this._loadUserCount();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not assign user: " + (e.message || "Unknown error"));
                });
        },

        _updateUser: function (oCtx, sType, bActive) {
            oCtx.setProperty("assignment_type", sType);
            oCtx.setProperty("active", bActive);

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCodeUsersUpdate")
                .then(function () {
                    MessageToast.show("User assignment updated.");
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not update assignment: " + (e.message || "Unknown error"));
                });
        },

        onDeleteUser: function (oEvent) {
            // The row's OWN context from the table's live binding — not a
            // freshly built bindContext() — is what the model actually
            // tracks and can delete (see the same note in
            // ReleaseCriteriaDetail.controller.js's onDeleteValue).
            var oRowCtx = oEvent.getSource().getBindingContext();
            var sUserId = oRowCtx.getProperty("user_id");

            MessageBox.confirm("Remove user \"" + sUserId + "\" from this release code?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    oRowCtx.delete("$auto")
                        .then(function () {
                            MessageToast.show("User removed.");
                            this._loadUserCount();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Delete failed: " + (e.message || "Unknown error"));
                        }.bind(this));
                }.bind(this)
            });
        },

        // ── Scope tab ─────────────────────────────────────────────────
        _loadScopeCount: function () {
            var oTable = this.byId("scopeTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iCount) {
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }
                    this._oViewModel.setProperty("/scopeCount", String(iCount || 0));
                }.bind(this)).catch(function () {
                    // New/unsaved record has no nav path yet — leave empty, no error.
                });
            }
        },

        _getLoadedScopeRows: function () {
            var oTable = this.byId("scopeTable");
            if (!oTable) { return []; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return []; }
            return oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
        },

        formatScopeTypeText: function (sType) {
            if (sType === "BP_ROLE")       { return "BP Role"; }
            if (sType === "MATERIAL_VIEW") { return "Material View"; }
            if (sType === "FIELD_GROUP")   { return "Field Group"; }
            return sType || "\u2014";
        },

        onAddScope: function () {
            if (this._oViewModel.getProperty("/isNew")) {
                MessageToast.show("Save the release code first before adding scope.");
                return;
            }
            this._openScopeDialog(null);
        },

        // scope_type + scope_id together are the row's full key (beyond
        // release_code), so OData can't PATCH them directly — but the user
        // shouldn't have to know or care about that. Row press opens the
        // same dialog pre-filled with the current values; if the user
        // changes either one, onSave (below) does a delete-old +
        // create-new under the hood as a single, seamless-looking edit.
        onScopeRowPress: function (oEvent) {
            this._openScopeDialog(oEvent.getSource().getBindingContext());
        },

        _openScopeDialog: function (oExistingCtx) {
            var bEdit = !!oExistingCtx;

            if (!this._oScopeDialog) {
                var oBpRoleSelect = new Select({ width: "100%", forceSelection: false });
                var oFieldGroupSelect = new Select({ width: "100%", forceSelection: false, visible: false });

                // No Material View master entity exists in this project yet
                // (ScopeType keeps the option open for a future master data
                // type) — fall back to a free-text ID until one is modeled.
                var oMaterialViewInput = new Input({
                    placeholder: "e.g. SALES1 (no Material View master data yet)",
                    visible: false
                });

                var oTypeSelect = new Select({
                    selectedKey: "BP_ROLE",
                    items: [
                        new Item({ key: "BP_ROLE",       text: "BP Role" }),
                        new Item({ key: "MATERIAL_VIEW",  text: "Material View" }),
                        new Item({ key: "FIELD_GROUP",    text: "Field Group" })
                    ],
                    change: function () {
                        var sType = oTypeSelect.getSelectedKey();
                        oBpRoleSelect.setVisible(sType === "BP_ROLE");
                        oFieldGroupSelect.setVisible(sType === "FIELD_GROUP");
                        oMaterialViewInput.setVisible(sType === "MATERIAL_VIEW");
                    }
                });

                this._oScopeDialog = new Dialog({
                    title  : "Add to Scope",
                    content: new SimpleForm({
                        editable: true,
                        layout  : "ResponsiveGridLayout",
                        content : [
                            new Label({ text: "Scope Type", required: true }), oTypeSelect,
                            new Label({ text: "Scope ID", required: true }), oBpRoleSelect, oFieldGroupSelect, oMaterialViewInput
                        ]
                    }),
                    beginButton: new Button({
                        text: "Add",
                        type: "Emphasized",
                        press: function () {
                            var sType = oTypeSelect.getSelectedKey();
                            var sId   = sType === "BP_ROLE"      ? oBpRoleSelect.getSelectedKey()
                                      : sType === "FIELD_GROUP"  ? oFieldGroupSelect.getSelectedKey()
                                      : oMaterialViewInput.getValue().trim();
                            var oCtxBeingEdited = this._oScopeDialog._oEditingCtx;

                            if (!sId) {
                                MessageBox.error("Please select or enter a Scope ID.");
                                return;
                            }

                            var bUnchanged = oCtxBeingEdited &&
                                oCtxBeingEdited.getProperty("scope_type") === sType &&
                                oCtxBeingEdited.getProperty("scope_id") === sId;

                            if (!bUnchanged) {
                                var bDuplicate = this._getLoadedScopeRows().some(function (o) {
                                    if (oCtxBeingEdited &&
                                        o.scope_type === oCtxBeingEdited.getProperty("scope_type") &&
                                        o.scope_id === oCtxBeingEdited.getProperty("scope_id")) {
                                        return false; // exclude the row currently being edited from the check
                                    }
                                    return o.scope_type === sType && o.scope_id === sId;
                                });
                                if (bDuplicate) {
                                    MessageBox.error("This " + this.formatScopeTypeText(sType) + " is already in scope.");
                                    return;
                                }
                            }

                            if (oCtxBeingEdited) {
                                if (bUnchanged) {
                                    // Nothing actually changed — just close, no request needed.
                                    this._oScopeDialog.close();
                                    return;
                                }
                                this._updateScope(oCtxBeingEdited, sType, sId);
                            } else {
                                this._createScope(sType, sId);
                            }

                            this._oScopeDialog.close();
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () { this._oScopeDialog.close(); }.bind(this)
                    })
                });
                this._oScopeDialog._oTypeSelect         = oTypeSelect;
                this._oScopeDialog._oBpRoleSelect       = oBpRoleSelect;
                this._oScopeDialog._oFieldGroupSelect   = oFieldGroupSelect;
                this._oScopeDialog._oMaterialViewInput  = oMaterialViewInput;
                this.getView().addDependent(this._oScopeDialog);
            }

            this._oScopeDialog._oEditingCtx = oExistingCtx;

            var oModel = this.getOwnerComponent().getModel();
            var oBpRoleSelect     = this._oScopeDialog._oBpRoleSelect;
            var oFieldGroupSelect = this._oScopeDialog._oFieldGroupSelect;
            var oMaterialViewInput = this._oScopeDialog._oMaterialViewInput;
            var oTypeSelect        = this._oScopeDialog._oTypeSelect;

            var sExistingType = bEdit ? oExistingCtx.getProperty("scope_type") : "BP_ROLE";
            var sExistingId   = bEdit ? oExistingCtx.getProperty("scope_id")   : "";

            // Populate both option lists fresh every time the dialog opens
            // (manual requestContexts population, not bindItems — a
            // standalone Select built purely in JS and attached late via
            // addDependent doesn't reliably resolve a declarative bindItems
            // binding; this is the same manual pattern already proven to
            // work elsewhere in this codebase, e.g. ReleaseCodes.controller.js's
            // lookups model and ReleaseStrategyDetail's criteria dialog).
            oModel.bindList("/BPRoles", null, [], [], { $select: "role_id,description" })
                .requestContexts(0, Infinity).then(function (aCtx) {
                    oBpRoleSelect.destroyItems();
                    aCtx.sort(function (a, b) {
                        return a.getProperty("role_id").localeCompare(b.getProperty("role_id"));
                    }).forEach(function (c) {
                        oBpRoleSelect.addItem(new Item({
                            key : c.getProperty("role_id"),
                            text: c.getProperty("role_id") + " \u2014 " + c.getProperty("description")
                        }));
                    });
                    oBpRoleSelect.setSelectedKey(sExistingType === "BP_ROLE" ? sExistingId : "");
                }).catch(function (e) {
                    console.error("[ReleaseCodeDetail] Failed to load BP Roles for scope dialog:", e.message);
                });

            oModel.bindList("/FieldGroups", null, [], [], { $select: "group_id,description" })
                .requestContexts(0, Infinity).then(function (aCtx) {
                    oFieldGroupSelect.destroyItems();
                    aCtx.sort(function (a, b) {
                        return a.getProperty("group_id").localeCompare(b.getProperty("group_id"));
                    }).forEach(function (c) {
                        oFieldGroupSelect.addItem(new Item({
                            key : c.getProperty("group_id"),
                            text: c.getProperty("group_id") + " \u2014 " + c.getProperty("description")
                        }));
                    });
                    oFieldGroupSelect.setSelectedKey(sExistingType === "FIELD_GROUP" ? sExistingId : "");
                }).catch(function (e) {
                    console.error("[ReleaseCodeDetail] Failed to load Field Groups for scope dialog:", e.message);
                });

            oTypeSelect.setSelectedKey(sExistingType);
            oBpRoleSelect.setVisible(sExistingType === "BP_ROLE");
            oFieldGroupSelect.setVisible(sExistingType === "FIELD_GROUP");
            oMaterialViewInput.setVisible(sExistingType === "MATERIAL_VIEW");
            oMaterialViewInput.setValue(sExistingType === "MATERIAL_VIEW" ? sExistingId : "");

            if (bEdit) {
                this._oScopeDialog.setTitle("Edit Scope");
                this._oScopeDialog.getBeginButton().setText("Save");
            } else {
                this._oScopeDialog.setTitle("Add to Scope");
                this._oScopeDialog.getBeginButton().setText("Add");
            }

            this._oScopeDialog.open();
        },

        _createScope: function (sType, sId) {
            var oTable = this.byId("scopeTable");
            if (!oTable) { return; }
            var oListBinding = oTable.getBinding("items");
            if (!oListBinding) { return; }

            // Same live-binding create pattern as _createUser above —
            // release_code is inherited implicitly from this nested
            // composition context.
            oListBinding.create({
                scope_type: sType,
                scope_id  : sId
            });

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCodeScopeUpdate")
                .then(function () {
                    MessageToast.show("Added to scope.");
                    this._loadScopeCount();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add to scope: " + (e.message || "Unknown error"));
                });
        },

        // "Editing" a scope row that changed its type/id is really a
        // delete-of-the-old-row + create-of-a-new-one, since scope_type +
        // scope_id together are the row's key beyond release_code and
        // OData can't PATCH key properties on an existing entity. Both
        // operations go through the same update group / batch so they
        // land together rather than as two separate visible round trips.
        _updateScope: function (oOldCtx, sNewType, sNewId) {
            var oTable = this.byId("scopeTable");
            if (!oTable) { return; }
            var oListBinding = oTable.getBinding("items");
            if (!oListBinding) { return; }

            var oModel = this.getOwnerComponent().getModel();

            oOldCtx.delete("$auto")
                .then(function () {
                    oListBinding.create({
                        scope_type: sNewType,
                        scope_id  : sNewId
                    });
                    return oModel.submitBatch("releaseCodeScopeUpdate");
                })
                .then(function () {
                    MessageToast.show("Scope updated.");
                    this._loadScopeCount();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not update scope: " + (e.message || "Unknown error"));
                }.bind(this));
        },

        onDeleteScope: function (oEvent) {
            var oRowCtx = oEvent.getSource().getBindingContext();
            var sLabel  = this.formatScopeTypeText(oRowCtx.getProperty("scope_type")) + " \u2013 " + oRowCtx.getProperty("scope_id");

            MessageBox.confirm("Remove \"" + sLabel + "\" from scope?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    oRowCtx.delete("$auto")
                        .then(function () {
                            MessageToast.show("Removed from scope.");
                            this._loadScopeCount();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Delete failed: " + (e.message || "Unknown error"));
                        }.bind(this));
                }.bind(this)
            });
        },

        // ── Used By Strategies tab (read-only) ───────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("release_code_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ReleaseStrategySteps", null, null, [
                new Filter("release_code_release_code_id", FilterOperator.EQ, sId)
            ], {
                $expand: "strategy($select=strategy_id,description,master_data_type_master_data_type_id,active)"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var aItems = aCtx.map(function (c) {
                    var oData     = c.getObject();
                    var oStrategy = oData.strategy || {};
                    return {
                        strategy_id: oStrategy.strategy_id,
                        description: oStrategy.description,
                        step_number: oData.step_number,
                        parallel   : oData.parallel,
                        active     : oStrategy.active
                    };
                }).filter(function (o) { return !!o.strategy_id; });

                oView.getModel("usage").setProperty("/items", aItems);
                this._oViewModel.setProperty("/usageCount", String(aItems.length));
            }.bind(this)).catch(function () {
                // New/unsaved record or no matches yet — leave empty, no error.
            });
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId          = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc        = this.byId("inDescription").getValue().trim();
            var sAppliesTo   = this.byId("selAppliesTo").getSelectedKey();
            var sSla         = this.byId("inSla").getValue().trim();
            var sEscalateTo  = this.byId("inEscalateTo").getValue().trim();
            var sEscalateHrs = this.byId("inEscalateHours").getValue().trim();
            var bActive      = this.byId("swActive").getState();

            if (!sId)               { MessageBox.error("Code ID is required."); return; }
            if (!/^[A-Z0-9_]{1,10}$/.test(sId)) {
                MessageBox.error("Code ID must be up to 10 characters — letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc)             { MessageBox.error("Description is required."); return; }
            if (!sSla || isNaN(sSla) || Number(sSla) <= 0) {
                MessageBox.error("SLA (hours) must be a positive number.");
                return;
            }
            if (sEscalateHrs && (isNaN(sEscalateHrs) || Number(sEscalateHrs) <= 0)) {
                MessageBox.error("Escalation After (hours) must be a positive number.");
                return;
            }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                if (bIsNew) { oCtx.setProperty("release_code_id", sId); }
                oCtx.setProperty("description", sDesc);
                oCtx.setProperty("master_data_type_master_data_type_id", sAppliesTo || null);
                oCtx.setProperty("sla_hours", Number(sSla));
                oCtx.setProperty("escalation_to", sEscalateTo || null);
                oCtx.setProperty("escalation_hours", sEscalateHrs ? Number(sEscalateHrs) : null);
                oCtx.setProperty("active", bActive);
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCodeUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Release code saved successfully.");

                    if (bWasCreated) {
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    if (/unique|constraint|primary key/i.test(sMsg)) {
                        sMsg = "A release code with ID \"" + sId + "\" already exists. Choose a different ID.";
                    }
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("releaseCodeUpdate");
                try { this.getOwnerComponent().getModel().resetChanges("releaseCodeUsersUpdate"); } catch (e) { /* no pending */ }
                try { this.getOwnerComponent().getModel().resetChanges("releaseCodeScopeUpdate"); } catch (e) { /* no pending */ }
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

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("releaseCodes");
        }
    });
});