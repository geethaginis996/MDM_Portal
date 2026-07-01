sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    MessageToast,
    MessageBox,
    DateFormat,
  ) {
    "use strict";

    var oDateFmt = DateFormat.getDateTimeInstance({ style: "medium" });

    return Controller.extend("mdm.portal.controller.FieldMasterDetail", {
      // ── Lifecycle ────────────────────────────────────────────────

      onInit: function () {
        this._oViewModel = new JSONModel({
          busy: false,
          isNew: false,
          isDirty: false,
          selectedTab: "general",
        });
        this.getView().setModel(this._oViewModel, "view");

        // Load all lookup dropdowns into a separate JSON model
        this._loadLookups();

        var oRouter = this.getOwnerComponent().getRouter();
        oRouter
          .getRoute("fieldMasterDetail")
          .attachPatternMatched(this._onRouteMatched, this);
      },

      // ── Lookup loader ────────────────────────────────────────────

      _loadLookups: function () {
        var oModel = this.getOwnerComponent().getModel();
        var oLookupsModel = new JSONModel({
          displayTypes: [],
          valueTables: [],
          validationRules: [],
          dataTypes: [],
          mainGroups: [],
        });
        this.getView().setModel(oLookupsModel, "lookups");

        oModel
          .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
          .requestContexts(0, 50)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/displayTypes",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("display_type_id"),
                  text: c.getProperty("display_type_name"),
                };
              }),
            );
          });

        oModel
          .bindList("/MetaDataTypes", null, [new Sorter("sequence")])
          .requestContexts(0, 50)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/dataTypes",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("code"),
                  text:
                    c.getProperty("code") +
                    " — " +
                    c.getProperty("description"),
                };
              }),
            );
          });

        oModel
          .bindList("/ValueTables", null, [new Sorter("value_table_id")])
          .requestContexts(0, 200)
          .then(function (aCtx) {
            var aItems = [{ key: "", text: "— None —" }];
            aCtx.forEach(function (c) {
              aItems.push({
                key: c.getProperty("value_table_id"),
                text:
                  c.getProperty("value_table_id") +
                  " — " +
                  c.getProperty("description"),
              });
            });
            oLookupsModel.setProperty("/valueTables", aItems);
          });

        oModel
          .bindList("/ValidationRules", null, [new Sorter("validation_id")])
          .requestContexts(0, 200)
          .then(function (aCtx) {
            var aItems = [{ key: "", text: "— None —" }];
            aCtx.forEach(function (c) {
              aItems.push({
                key: c.getProperty("validation_id"),
                text:
                  c.getProperty("validation_id") +
                  " — " +
                  c.getProperty("function_name"),
              });
            });
            oLookupsModel.setProperty("/validationRules", aItems);
          });

        oModel
          .bindList(
            "/FieldGroups",
            null,
            [new Sorter("sequence")],
            [new Filter("parent_group_id_group_id", FilterOperator.EQ, null)],
          )
          .requestContexts(0, 100)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/mainGroups",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("group_id"),
                  text:
                    c.getProperty("group_id") +
                    " — " +
                    c.getProperty("description"),
                };
              }),
            );
          });
      },

      // ── Route matched ────────────────────────────────────────────

      _onRouteMatched: function (oEvent) {
        var sRaw     = decodeURIComponent(oEvent.getParameter("arguments").fieldId);
        var sFieldId = sRaw === "NEW" ? "NEW" : sRaw.toUpperCase();
        // Reset dirty flag on every navigation
        this._oViewModel.setProperty("/isDirty", false);

        if (sFieldId === "NEW") {
          this._createNewField();
        } else {
          this._bindField(sFieldId);
        }
      },

      // ── Binding ──────────────────────────────────────────────────

      _bindField: function (sFieldId) {
        this._oViewModel.setProperty("/isNew", false);
        this._oViewModel.setProperty("/busy", true);

        var sPath = "/FieldMasters('" + sFieldId + "')";
        this.getView().bindObject({
          path: sPath,
          parameters: {
            $select: [
              "field_id", "description", "data_type", "length", "decimals",
              "display_type", "active", "source_table", "source_field",
              "main_group_group_id", "sub_group_group_id",
              "value_table_value_table_id", "validation_validation_id"
            ].join(","),
            $expand: [
              "main_group($select=group_id,description)",
              "sub_group($select=group_id,description)",
              "value_table($select=value_table_id,source_table,output_key,output_desc,description)",
              "validation($select=validation_id,function_name,description,input_param_1,input_param_2,input_param_3,error_message)",
            ].join(","),
            $$updateGroupId: "fieldMasterUpdate", // holds changes until submitBatch
          },
          events: {
            dataReceived: function () {
              this._oViewModel.setProperty("/busy", false);
              var oCtx = this.getView().getBindingContext();
              if (!oCtx) {
                MessageToast.show("Field not found");
                this.onNavBack();
                return;
              }
              oCtx.requestObject().then(
                function (oData) {
                  this._updateHeader(oData);
                  this._updateValueTablePreview(oData.value_table);
                  this._updateValidationPreview(oData.validation);
                  this._loadSubGroups(oData.main_group_group_id);
                }.bind(this),
              );
              // Existing field — Field ID should not be changed
              this.byId("inFieldId").setEditable(false);
            }.bind(this),
          },
        });
      },

      // ── New field ────────────────────────────────────────────────

      _createNewField: function () {
        this._oViewModel.setProperty("/isNew", true);
        this._oViewModel.setProperty("/busy", true);

        var oModel = this.getView().getModel();

        Promise.all([
          oModel
            .bindList("/MetaDataTypes", null, [new Sorter("sequence")])
            .requestContexts(0, 1),
          oModel
            .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
            .requestContexts(0, 1),
        ])
          .then(
            function (aResults) {
              var sDefaultDataType = aResults[0].length
                ? aResults[0][0].getProperty("code")
                : "";
              var sDefaultDisplayType = aResults[1].length
                ? aResults[1][0].getProperty("display_type_id")
                : "";

              var oListBinding = oModel.bindList("/FieldMasters", null, [], [], {
                $$updateGroupId: "fieldMasterUpdate"
              });
              // Keep a reference so the transient row is not discarded by the
              // OData V4 model before submitBatch sends its POST.
              this._oCreateListBinding = oListBinding;
              var oContext = oListBinding.create({
                field_id: "",
                description: "",
                data_type: sDefaultDataType,
                length: 10,
                decimals: null,
                display_type: sDefaultDisplayType,
                active: true,
                source_table: "",
                source_field: "",
              });
              // If the previous page was an existing field, the view still
              // carries the object binding _bindField set up via bindObject().
              // An object binding's context takes precedence over
              // setBindingContext, so without unbinding it first the form
              // keeps showing that old record's data instead of a blank one —
              // the same issue already fixed in onCopy below.
              this.getView().unbindObject();
              this.getView().setBindingContext(oContext);
              this._updateHeader({ field_id: "New Field", description: "" });
              this._oViewModel.setProperty("/busy", false);
            }.bind(this),
          )
          .catch(
            function () {
              var oListBinding = oModel.bindList("/FieldMasters", null, [], [], {
                $$updateGroupId: "fieldMasterUpdate"
              });
              this._oCreateListBinding = oListBinding;
              var oContext = oListBinding.create({
                field_id: "",
                description: "",
                data_type: "",
                length: 10,
                decimals: null,
                display_type: "",
                active: true,
                source_table: "",
                source_field: "",
              });
              this.getView().unbindObject();
              this.getView().setBindingContext(oContext);
              this._updateHeader({ field_id: "New Field", description: "" });
              this._oViewModel.setProperty("/busy", false);
            }.bind(this),
          );
      },

      // ── Header helpers ───────────────────────────────────────────

      _updateHeader: function (oData) {
        var sTitle = oData.field_id
          ? oData.field_id +
            (oData.description ? " — " + oData.description : "")
          : "New Field";
        this.byId("pageTitle").setText(sTitle);
        this.byId("attrStatus").setText(oData.active ? "Active" : "Inactive");
        this.byId("attrCreated").setText(oData.createdBy || "—");
        this.byId("attrDate").setText(
          oData.createdAt ? oDateFmt.format(new Date(oData.createdAt)) : "—",
        );
        this.byId("attrModified").setText(
          oData.modifiedAt ? oDateFmt.format(new Date(oData.modifiedAt)) : "—",
        );
      },

      // ── Dirty flag ───────────────────────────────────────────────

      onFieldChange: function () {
        this._oViewModel.setProperty("/isDirty", true);
      },

      // ── Tab 2: Grouping ──────────────────────────────────────────

      onMainGroupChange: function (oEvent) {
        var sGroupId = oEvent.getSource().getSelectedKey();
        this._loadSubGroups(sGroupId);
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
      },

      _loadSubGroups: function (sMainGroupId) {
        if (!sMainGroupId) {
          return;
        }
        var oSubSel = this.byId("selSubGroup");
        if (!oSubSel) {
          return; // Grouping tab removed — nothing to populate
        }
        var oModel = this.getView().getModel();
        oModel
          .bindList("/FieldGroups", null, null, [
            new Filter(
              "parent_group_id_group_id",
              FilterOperator.EQ,
              sMainGroupId,
            ),
          ])
          .requestContexts()
          .then(function (aContexts) {
            oSubSel.destroyItems();
            aContexts.forEach(function (oCtx) {
              oSubSel.addItem(
                new sap.ui.core.Item({
                  key: oCtx.getProperty("group_id"),
                  text:
                    oCtx.getProperty("group_id") +
                    " — " +
                    oCtx.getProperty("description"),
                }),
              );
            });
          });
      },

      // ── Tab 3: Value Help ────────────────────────────────────────

      onValueTableChange: function (oEvent) {
        var sKey = oEvent.getSource().getSelectedKey();
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
        this._updateValueTablePreview(sKey ? { value_table_id: sKey } : null);
      },

      _updateValueTablePreview: function (oVT) {
        if (!oVT || !oVT.value_table_id) {
          this.byId("vtSource").setText("—");
          this.byId("vtOutputKey").setText("—");
          this.byId("vtOutputDesc").setText("—");
          return;
        }
        if (oVT.source_table) {
          this.byId("vtSource").setText(oVT.source_table);
          this.byId("vtOutputKey").setText(oVT.output_key || "—");
          this.byId("vtOutputDesc").setText(oVT.output_desc || "—");
        } else {
          this.getView()
            .getModel()
            .bindContext("/ValueTables('" + oVT.value_table_id + "')")
            .requestObject()
            .then(
              function (oData) {
                this.byId("vtSource").setText(oData.source_table || "—");
                this.byId("vtOutputKey").setText(oData.output_key || "—");
                this.byId("vtOutputDesc").setText(oData.output_desc || "—");
              }.bind(this),
            );
        }
      },

      // ── Tab 4: Validation ────────────────────────────────────────

      onValidationChange: function (oEvent) {
        var sKey = oEvent.getSource().getSelectedKey();
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
        if (!sKey) {
          this._clearValidationPreview();
          return;
        }
        this.getView()
          .getModel()
          .bindContext("/ValidationRules('" + sKey + "')")
          .requestObject()
          .then(
            function (oData) {
              this._updateValidationPreview(oData);
            }.bind(this),
          );
      },

      _updateValidationPreview: function (oRule) {
        if (!oRule) {
          this._clearValidationPreview();
          return;
        }
        this.byId("valFnName").setText(oRule.function_name || "—");
        this.byId("valDesc").setText(oRule.description || "—");
        this.byId("valParam1").setText(oRule.input_param_1 || "—");
        this.byId("valParam2").setText(oRule.input_param_2 || "—");
        this.byId("valParam3").setText(oRule.input_param_3 || "—");
        this.byId("valErrMsg").setText(oRule.error_message || "—");
      },

      _clearValidationPreview: function () {
        [
          "valFnName",
          "valDesc",
          "valParam1",
          "valParam2",
          "valParam3",
          "valErrMsg",
        ].forEach(
          function (sId) {
            this.byId(sId).setText("—");
          }.bind(this),
        );
      },

      // ── Tab 5: Usage ─────────────────────────────────────────────

      onUsageRowPress: function (oEvent) {
        var oCtx = oEvent.getSource().getBindingContext();
        var sRoleId = oCtx.getProperty("role_role_id");
        if (sRoleId) {
          this.getOwnerComponent()
            .getRouter()
            .navTo("bpRoleDetail", {
              roleId: encodeURIComponent(sRoleId.toLowerCase()),
            });
        }
      },

      // ── Save ─────────────────────────────────────────────────────

      onSave: function () {
        var sFieldId = this.byId("inFieldId").getValue().trim();
        var sDesc = this.byId("inDescription").getValue().trim();

        if (!sFieldId) {
          MessageBox.error("Field Name is required.");
          return;
        }
        if (!sDesc) {
          MessageBox.error("Description is required.");
          return;
        }

        // A Dropdown or Search Help display type renders a value list — without a
        // Value Table mapped, it would show with nothing to select. Require one
        // before saving so the field is actually usable once created.
        var sDisplayType = this.byId("selDisplayType").getSelectedKey();
        var sValueTable  = this.byId("selValueTable").getSelectedKey();
        if ((sDisplayType === "DROPDOWN" || sDisplayType === "SEARCH_HELP") && !sValueTable) {
          MessageBox.error("A Value Table is required when Display Type is Dropdown or Search Help. Select one on the Value Help tab before saving.");
          this.byId("detailTabs").setSelectedKey("valuehelp");
          return;
        }

        this._oViewModel.setProperty("/busy", true);

        var bIsNew = this._oViewModel.getProperty("/isNew");
        var oCtx   = this.getView().getBindingContext();

        // field_id is the key and is two-way bound; ensure it is set for new records
        if (oCtx && bIsNew) {
          oCtx.setProperty("field_id", sFieldId);
        }

        this.getView()
          .getModel()
          .submitBatch("fieldMasterUpdate")
          .then(
            function () {
              if (bIsNew && oCtx && typeof oCtx.created === "function") {
                var pCreated = oCtx.created();
                if (pCreated && typeof pCreated.then === "function") {
                  return pCreated.then(function () { return true; });
                }
                return true;
              }
              return false;
            }
          )
          .then(
            function (bWasCreated) {
              this._oViewModel.setProperty("/busy", false);
              this._oViewModel.setProperty("/isDirty", false);
              MessageToast.show("Field saved successfully.");

              if (bWasCreated) {
                // Showing the toast and navigating away in the same tick lets the
                // route change tear the page down before the toast has actually
                // painted, so it never becomes visible. A short delay lets it
                // render first; the toast itself still floats above the list
                // once we're there.
                setTimeout(this.onNavBack.bind(this), 300);
              } else {
                var oCtx2 = this.getView().getBindingContext();
                if (oCtx2) {
                  oCtx2.requestObject().then(
                    function (oData) {
                      if (oData) { this._updateHeader(oData); }
                    }.bind(this),
                  );
                }
              }
            }.bind(this),
          )
          .catch(
            function (oErr) {
              this._oViewModel.setProperty("/busy", false);
              // A failed create is kept by OData V4 and retried on every later
              // submitBatch, which jams the group. Roll back the pending change
              // so the app stays usable; the user can correct and save again.
              try { this.getView().getModel().resetChanges("fieldMasterUpdate"); } catch (e) { /* nothing pending */ }
              if (bIsNew) { this._oCreateListBinding = null; }
              MessageBox.error(
                "Save failed: " + (oErr.message || "Unknown error"),
              );
            }.bind(this),
          );
      },

      // ── Cancel ───────────────────────────────────────────────────

      onCancel: function () {
        var fnGoBack = function () {
          this.getView().getModel().resetChanges("fieldMasterUpdate");
          this._oViewModel.setProperty("/isDirty", false);
          this.onNavBack();
        }.bind(this);

        if (this._oViewModel.getProperty("/isDirty")) {
          MessageBox.confirm("Discard unsaved changes?", {
            onClose: function (sAction) {
              if (sAction === MessageBox.Action.OK) {
                fnGoBack();
              }
            },
          });
        } else {
          fnGoBack();
        }
      },

      onCopy: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) {
          MessageToast.show("No field selected to copy.");
          return;
        }
        // Clear any stale pending create/patch from a previous copy attempt so
        // it cannot keep retrying and colliding on the key.
        this.getView().getModel().resetChanges("fieldMasterUpdate");

        // Read current field data
        oCtx.requestObject().then(
          function (oData) {
            var oModel = this.getView().getModel();

            // Create a new record pre-populated with copied values
            // Field ID is cleared — user must enter a unique one.
            // Bound to the deferred update group so it is NOT auto-posted
            // (with $auto, a groupless create posts immediately with empty id).
            var oListBinding = oModel.bindList("/FieldMasters", null, [], [], {
              $$updateGroupId: "fieldMasterUpdate"
            });
            var oNewContext = oListBinding.create({
              field_id: "",
              description: oData.description + " (Copy)",
              data_type: oData.data_type,
              length: oData.length,
              decimals: oData.decimals,
              display_type: oData.display_type,
              active: false, // new copy starts inactive
              source_table: oData.source_table,
              source_field: oData.source_field,
              main_group_group_id: oData.main_group_group_id,
              sub_group_group_id: oData.sub_group_group_id,
              value_table_value_table_id: oData.value_table_value_table_id,
              validation_validation_id: oData.validation_validation_id,
            });
            // Keep a reference so the transient list binding is not garbage-collected.
            this._oCreateListBinding = oListBinding;

            // The view still carries the object binding from the record we copied
            // FROM (set by _bindField via bindObject). An object binding's context
            // takes precedence over setBindingContext, so without unbinding it the
            // form keeps showing the original record and the copy appears to do
            // nothing. Unbind first, THEN point the view at the new transient row.
            this.getView().unbindObject();

            // Switch view to the new context
            this.getView().setBindingContext(oNewContext);

            // Field ID was made read-only while viewing the source record; the
            // copy needs a brand-new key, so re-enable the input.
            this.byId("inFieldId").setEditable(true);

            // Reset state flags
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/isDirty", true);

            // Update header to show copy mode
            this._updateHeader({
              field_id: "",
              description: oData.description + " (Copy)",
              active: false,
              createdBy: null,
              createdAt: null,
              modifiedAt: null,
            });

            // Reload sub groups for the copied main group
            this._loadSubGroups(oData.main_group_group_id);

            // Update previews
            this._updateValueTablePreview(oData.value_table);
            this._updateValidationPreview(oData.validation);

            // Switch to General tab so user sees Field ID input first
            this.byId("detailTabs").setSelectedKey("general");

            MessageToast.show(
              "Field copied — enter a new Field Name and press Save.",
            );
          }.bind(this),
        );
      },

      // ── Tab bar ──────────────────────────────────────────────────

      onTabSelect: function (oEvent) {
        var sKey = oEvent.getParameter("key");
        this._oViewModel.setProperty("/selectedTab", sKey);
        if (sKey === "usage") {
          this._loadUsage();
        }
        if (sKey === "changelog") {
          this._loadChangeLog();
        }
      },

      _loadUsage: function () {
        // Never attempt to load usage data for an unsaved new field.
        // The transient OData V4 context created by listBinding.create()
        // has field_id = "" at creation time, but between navigation and
        // the setBindingContext() call completing, getBindingContext() can
        // still return the *previous* field's context — causing _loadUsage
        // to query BPRoleFields with that stale field_id and showing the
        // previous field's role assignments on the new-field form.
        if (this._oViewModel.getProperty("/isNew")) {
          // Clear any stale data from a previous field's usage load
          var oUsageModel = this.getView().getModel("usage");
          if (oUsageModel) { oUsageModel.setProperty("/items", []); }
          this.byId("usageCount") && this.byId("usageCount").setText("0 role assignments");
          return;
        }

        var oCtx = this.getView().getBindingContext();
        if (!oCtx) {
          return;
        }
        var sFieldId = oCtx.getProperty("field_id");
        if (!sFieldId) {
          return;
        }

        var oTable = this.byId("usageTable");
        var oBinding = oTable.getBinding("items");
        if (!oBinding) {
          return;
        }

        oBinding.filter([
          new Filter("field_field_id", FilterOperator.EQ, sFieldId),
        ]);
        oBinding.attachEventOnce(
          "dataReceived",
          function () {
            var iCount = oBinding.getLength();
            this.byId("usageCount").setText(
              iCount + " role assignment" + (iCount !== 1 ? "s" : ""),
            );
          }.bind(this),
        );
      },

      _loadChangeLog: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) { return; }
        var sFieldId = oCtx.getProperty("field_id");
        if (!sFieldId) { return; }

        // Populate managed-field strip
        var oVm = this._oViewModel;
        oVm.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
        oVm.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "—");
        oVm.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
        oVm.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "—");

        var oTable = this.byId("logTable");
        var oBinding = oTable && oTable.getBinding("items");
        if (!oBinding) { return; }
        oBinding.filter([
          new Filter("entity_name", FilterOperator.EQ, "FieldMaster"),
          new Filter("entity_key",  FilterOperator.EQ, sFieldId),
        ]);
        oBinding.resume();
      },

      _fmtDate: function (sVal) {
        if (!sVal) { return "—"; }
        try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
      },

      // ── Navigation ───────────────────────────────────────────────

      onNavBack: function () {
        this.getOwnerComponent().getRouter().navTo("fieldMaster");
      },

      onNavHome: function () {
        this.getOwnerComponent().getRouter().navTo("masterDataTypes");
      },
    });
  },
);