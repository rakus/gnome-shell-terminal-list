#
# Makefile for term-list
#
# Configuration is via src/metadata.json
# Used entries:
#   - uuid
#   - version
#
# Requires GNU make
#

ROOT_DIR := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))

# Phony targets represents recipes, not files
.PHONY: help zip html clean  install diff-installed check

# check that jq is available
JQ_AVAILABLE := $(shell command -v jq 2>/dev/null)
ifeq "${JQ_AVAILABLE}" ""
$(error "jq is not available -- please install jq")
endif

# extract data from metadata.json
EXT_UUID       := $(shell jq -er 'select(.uuid != null)|.uuid' src/metadata.json)
EXT_NAME       := $(firstword $(subst @, ,$(EXT_UUID)))
EXT_VERSION    := $(shell jq 'select(.version != null)|.version'  src/metadata.json)

ifeq "${EXT_UUID}" ""
$(error "Failed to extract extension UUID from src/metadata.json -- can't continue")
endif
ifeq "${EXT_NAME}" ""
$(error "Failed to extract extension NAME via UUID from src/metadata.json -- can't continue")
endif
ifeq "${EXT_VERSION}" ""
$(error "Failed to extract extension VERSION from src/metadata.json -- can't continue")
endif

EXT_ZIP        := ${EXT_NAME}-v${EXT_VERSION}.zip
LOCAL_EXT_INST_DIR = ${HOME}/.local/share/gnome-shell/extensions/${EXT_UUID}

JAVASCRIPT := $(wildcard src/*.js)
METADATA   := src/metadata.json
CSS        := $(wildcard src/*.css)
UI_FILES   := $(wildcard src/*.ui)
SRC_FILES  := ${JAVASCRIPT} ${METADATA} ${CSS} ${UI_FILES}
SCHEMAS    := $(wildcard src/schemas/*.xml)

GSCHEMAS   := src/schemas/gschemas.compiled

ZIP_CONTENT := ${SRC_FILES} ${GSCHEMAS} ${SCHEMAS}

ESLINT_AVAILABLE     := $(shell npx --no-install eslint  2> /dev/null && echo "GOT IT")
GTKBUILDER_AVAILABLE := $(shell which gtk-builder-tool 2> /dev/null)

all: check zip                           ## Run 'check' and 'zip'

zip: ${EXT_ZIP}                          ## Build gnome shell extension installable zip

check:                                   ## Run checks (jq, eslint, gtk-builder-tool)
	jq < ${METADATA} >/dev/null
ifdef GTKBUILDER_AVAILABLE
	gtk-builder-tool validate ${UI_FILES}
else
	@echo "WARNING: gtk-builder-tool not available, ui files not validated"
endif
ifdef ESLINT_AVAILABLE
	npx --no-install eslint -f unix ${JAVASCRIPT}
else
	@echo "WARNING: eslint not available, no static code check"
endif

print-metadata:                          ## Print data parsed from src/metadata.json for review
	@echo "Extension Name:    ${EXT_NAME}"
	@echo "Extension UUID:    ${EXT_UUID}"
	@echo "Extension Version: ${EXT_VERSION}"

${EXT_ZIP}: ${ZIP_CONTENT}
	@rm -f $@
	@(cd src && zip ../$@ ${ZIP_CONTENT:src/%=%})

html: README.html                        ## Create HTML from markdown files for review

README.html: README.md

%.html: %.md
	marked --gfm --tables -o $@ $^

install: ${ZIP_CONTENT} check            ## Install/update the extension locally
	@mkdir -p ${LOCAL_EXT_INST_DIR}
	@(cd src && cp -vf --parent ${ZIP_CONTENT:src/%=%} "${LOCAL_EXT_INST_DIR}")

${GSCHEMAS}: ${SCHEMAS}
	glib-compile-schemas --strict src/schemas

diff-installed:                         ## Diff agains locally installed extension
	@diff -x '*.sh' -x '*~' -x 'org.gnome.shell.extensions.*.gschema.xml' -r ${LOCAL_EXT_INST_DIR} src/

clean:                                  ## Clean up
	rm -rf ${EXT_NAME}-v*.zip *.html ${GSCHEMAS}

help:                                   ## Prints targets with help text
	@cat $(MAKEFILE_LIST) | grep -E '^[a-zA-Z_-]+:.*?## .*$$' | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%s\033[0m\n    %s\n", $$1, $$2}'

